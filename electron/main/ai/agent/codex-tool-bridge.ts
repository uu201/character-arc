import type { AiAgentStreamHandlers, AiRunUsage, AppSettings, ToolCallTrace } from '../shared-types'
import { runCodexCli } from '../codex-cli'
import { stripReasoningMarkup } from '../reasoning'
import type { Tool, ToolContext } from './tools/types'
import type { TurnImageAttachment } from '@shared/assistant-runtime'

type CodexToolCall = {
  name: string
  arguments: Record<string, unknown>
}

type CodexToolEnvelope = {
  toolCalls: CodexToolCall[]
  finalText: string
}

export type RunCodexToolAgentParams = {
  settings: AppSettings
  systemPrompt: string
  userPrompt: string
  imageAttachments?: TurnImageAttachment[]
  tools: Tool[]
  ctx: ToolContext
  handlers: AiAgentStreamHandlers
  maxSteps: number
  disableTools?: boolean
}

export type CodexToolAgentResult = {
  finalText: string
  toolCalls: ToolCallTrace[]
  iterations: number
  usage?: AiRunUsage
}

const MAX_TOOL_CALLS_PER_STEP = 12
const MAX_TOOL_RESULT_CHARS = 20_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`
}

function mergeUsage(a: AiRunUsage | undefined, b: AiRunUsage | undefined): AiRunUsage | undefined {
  if (!a) return b
  if (!b) return a
  const sum = (x?: number, y?: number): number | undefined =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0)
  return {
    promptTokens: sum(a.promptTokens, b.promptTokens),
    completionTokens: sum(a.completionTokens, b.completionTokens),
    totalTokens: sum(a.totalTokens, b.totalTokens),
    reasoningTokens: sum(a.reasoningTokens, b.reasoningTokens),
    cachedInputTokens: sum(a.cachedInputTokens, b.cachedInputTokens)
  }
}

/** 从混合文本中提取彼此相邻的顶层 JSON 对象，正确跳过字符串里的花括号。 */
function extractTopLevelJsonObjects(text: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"' && depth > 0) {
      inString = true
    } else if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1))
        start = -1
      }
    }
  }
  return objects
}

function jsonCandidates(text: string): string[] {
  const trimmed = stripReasoningMarkup(text).trim()
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) candidates.push(fenced)
  candidates.push(...extractTopLevelJsonObjects(trimmed))
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }
  return [...new Set(candidates)]
}

/** 解析 Codex 返回的宿主工具协议；普通聊天文本返回 null，由调用方直接展示。 */
export function parseCodexToolEnvelope(text: string): CodexToolEnvelope | null {
  let latest: CodexToolEnvelope | null = null
  for (const candidate of jsonCandidates(text)) {
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch {
      continue
    }
    if (!isRecord(value) || !Array.isArray(value.toolCalls) || typeof value.finalText !== 'string') {
      continue
    }
    const toolCalls: CodexToolCall[] = []
    let valid = true
    for (const rawCall of value.toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP)) {
      if (!isRecord(rawCall) || typeof rawCall.name !== 'string' || !isRecord(rawCall.arguments)) {
        valid = false
        break
      }
      const name = rawCall.name.trim()
      if (!name) {
        valid = false
        break
      }
      toolCalls.push({ name, arguments: rawCall.arguments })
    }
    if (valid) latest = { toolCalls, finalText: value.finalText.trim() }
  }
  return latest
}

function buildToolProtocolPrompt(tools: Tool[]): string {
  const catalog = tools.map((tool) => ({
    name: tool.definition.name,
    description: tool.definition.description,
    inputSchema: tool.definition.inputSchema
  }))
  return [
    '【CharacterArc 宿主工具协议】',
    '你可以通过下面的 JSON 协议请求 CharacterArc 执行进程内工具。这里的工具由应用宿主执行，不是 Codex CLI 的 shell 工具；即使本地 shell 工具被禁用，也必须按任务需要调用这些宿主工具。',
    '每次回复必须只输出一个 JSON 对象，不能使用 Markdown 代码块，也不能在 JSON 前后添加说明：',
    '{"toolCalls":[{"name":"工具名","arguments":{"参数":"值"}}],"finalText":""}',
    '规则：',
    '1. 需要读取资料或生成暂存变更时，把调用写入 toolCalls，并把 finalText 留空。宿主执行后会把结果发给你继续处理。',
    '2. 已经得到足够结果时，toolCalls 传空数组，把面向用户的中文回复写入 finalText。',
    '3. 修改项目数据必须调用对应的 stage_* 工具进入暂存区，绝不能只在 finalText 里描述拟修改内容，也不要声称工具不可用。',
    '4. 只能使用目录里列出的工具和参数；不得虚构工具名。',
    '',
    '【可用宿主工具目录】',
    JSON.stringify(catalog)
  ].join('\n')
}

function buildFollowupPrompt(
  originalUserPrompt: string,
  observations: Array<{ tool: string; arguments: Record<string, unknown>; content: string; isError: boolean }>
): string {
  const results = observations.map((item, index) => [
    `### 结果 ${index + 1}：${item.tool}${item.isError ? '（失败）' : ''}`,
    `参数：${stableStringify(item.arguments)}`,
    item.content.slice(0, MAX_TOOL_RESULT_CHARS)
  ].join('\n')).join('\n\n')
  return [
    '【原始用户请求】',
    originalUserPrompt,
    '',
    '【本轮已执行的宿主工具结果】',
    results,
    '',
    '请根据结果继续处理。若仍需读取或暂存，继续输出 toolCalls；若任务已完成，输出空 toolCalls 和最终回复。'
  ].join('\n')
}

function formatToolError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runTextOnly(params: RunCodexToolAgentParams): Promise<CodexToolAgentResult> {
  params.handlers.onAgentStatus('正在通过 Codex CLI 思考...', 1, 1)
  const result = await runCodexCli(
    params.settings,
    { system: params.systemPrompt, user: params.userPrompt },
    { signal: params.ctx.signal, handlers: params.handlers, images: params.imageAttachments }
  )
  return {
    finalText: stripReasoningMarkup(result.text),
    toolCalls: [],
    iterations: 1,
    usage: result.usage
  }
}

/**
 * Codex CLI 本身不能直接持有 Electron 进程内函数，因此用受限 JSON 协议桥接：
 * Codex 只选择工具和参数，实际读取与暂存仍由 CharacterArc 宿主执行。
 */
export async function runCodexToolAgent(
  params: RunCodexToolAgentParams
): Promise<CodexToolAgentResult> {
  if (params.disableTools || params.tools.length === 0) return await runTextOnly(params)

  const toolsByName = new Map(params.tools.map((tool) => [tool.definition.name, tool]))
  const protocolPrompt = buildToolProtocolPrompt(params.tools)
  const traces: ToolCallTrace[] = []
  const observations: Array<{
    tool: string
    arguments: Record<string, unknown>
    content: string
    isError: boolean
  }> = []
  const seenResults = new Map<string, { content: string; isError: boolean }>()
  let usage: AiRunUsage | undefined

  for (let step = 1; step <= params.maxSteps; step += 1) {
    params.ctx.signal.throwIfAborted()
    params.handlers.onAgentStatus(
      step === 1 ? '正在通过 Codex CLI 思考...' : `Codex CLI 第 ${step} 轮处理中...`,
      step,
      params.maxSteps
    )
    const prompt = step === 1
      ? params.userPrompt
      : buildFollowupPrompt(params.userPrompt, observations)
    const result = await runCodexCli(
      params.settings,
      {
        system: [params.systemPrompt, protocolPrompt].join('\n\n'),
        user: prompt
      },
      {
        signal: params.ctx.signal,
        images: params.imageAttachments,
        // 协议 JSON 不能作为聊天正文显示；推理过程仍照常转发。
        handlers: {
          onTextDelta: () => {},
          onReasoningDelta: params.handlers.onReasoningDelta
        }
      }
    )
    usage = mergeUsage(usage, result.usage)
    const envelope = parseCodexToolEnvelope(result.text)

    // 向下兼容普通文本回复。协议解析失败时仍可聊天，但不会伪造工具执行结果。
    if (!envelope) {
      const finalText = stripReasoningMarkup(result.text).trim()
      if (finalText) params.handlers.onTextDelta(finalText)
      return { finalText, toolCalls: traces, iterations: step, usage }
    }

    if (envelope.toolCalls.length === 0) {
      if (!envelope.finalText) {
        throw new Error('Codex CLI 返回了空的工具协议响应。')
      }
      params.handlers.onTextDelta(envelope.finalText)
      return {
        finalText: envelope.finalText,
        toolCalls: traces,
        iterations: step,
        usage
      }
    }

    let stepHasError = false
    for (const [index, call] of envelope.toolCalls.entries()) {
      const toolUseId = `codex-${step}-${index + 1}`
      const startedAt = Date.now()
      params.handlers.onToolUseStart(toolUseId, call.name, call.arguments)

      const fingerprint = `${call.name}:${stableStringify(call.arguments)}`
      const cached = seenResults.get(fingerprint)
      let content = ''
      let isError = false
      if (cached) {
        content = `（相同工具和参数已执行过，未重复写入。）\n${cached.content}`
        isError = cached.isError
      } else {
        const tool = toolsByName.get(call.name)
        if (!tool) {
          content = `未知宿主工具：${call.name}。请只使用可用工具目录中的名称。`
          isError = true
        } else {
          try {
            const toolResult = await tool.handler(call.arguments, params.ctx)
            content = toolResult.content
            isError = Boolean(toolResult.isError)
          } catch (error) {
            content = formatToolError(error)
            isError = true
          }
        }
        seenResults.set(fingerprint, { content, isError })
      }

      const durationMs = Date.now() - startedAt
      params.handlers.onToolResult(
        toolUseId,
        call.name,
        content.slice(0, 800),
        isError,
        durationMs
      )
      traces.push({
        tool: call.name,
        args: call.arguments,
        durationMs,
        status: isError ? 'error' : 'ok',
        ...(isError ? { error: content.slice(0, 240) } : {})
      })
      observations.push({ tool: call.name, arguments: call.arguments, content, isError })
      stepHasError ||= isError
    }

    // 兼容少数模型在同一协议响应中同时给出成功工具调用和最终说明。
    if (envelope.finalText && !stepHasError) {
      params.handlers.onTextDelta(envelope.finalText)
      return {
        finalText: envelope.finalText,
        toolCalls: traces,
        iterations: step,
        usage
      }
    }
  }

  const stagedCount = traces.filter((trace) => trace.status === 'ok' && trace.tool.startsWith('stage_')).length
  if (stagedCount > 0) {
    const finalText = `已生成 ${stagedCount} 条待审阅变更，请在右侧暂存区逐条确认。`
    params.handlers.onTextDelta(finalText)
    return {
      finalText,
      toolCalls: traces,
      iterations: params.maxSteps,
      usage
    }
  }
  throw new Error(`Codex CLI 在 ${params.maxSteps} 轮内未能完成宿主工具任务。`)
}
