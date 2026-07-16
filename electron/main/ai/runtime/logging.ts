import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings, AiRunKnowledgeItem, PromptPair } from '../shared-types'
import type { SkillSelection } from '../skills/types'

/** 日志存放目录 */
const AI_PROMPT_LOG_DIR = join(process.cwd(), '.logs')
/** AI 提示词日志文件路径 */
const AI_PROMPT_LOG_FILE = join(AI_PROMPT_LOG_DIR, 'ai-prompts.log')

function formatLogTimestamp(date = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  const offsetHours = Math.floor(absoluteOffset / 60)
  const offsetRemainderMinutes = absoluteOffset % 60

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    + `${offsetSign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`
}

/** 将内容追加写入提示词日志文件，写入失败时仅打印错误不抛出 */
async function writePromptLogFile(content: string): Promise<void> {
  try {
    await mkdir(AI_PROMPT_LOG_DIR, { recursive: true })
    await appendFile(AI_PROMPT_LOG_FILE, `${content}\n`, 'utf8')
  } catch (error) {
    console.error('[ai] failed to write prompt log file:', error)
  }
}

/**
 * 记录 AI 提示词请求日志（系统提示词 + 用户提示词）
 * @param label - 日志标签，如 REQUEST、REPAIR_1
 * @param settings - 应用设置
 * @param prompt - 系统/用户提示词对
 * @param taskName - 任务名称
 * @param usedSkills - 可选的已使用技能 ID 列表
 */
export function logPrompt(
  label: string,
  settings: AppSettings,
  prompt: PromptPair,
  taskName: string,
  usedSkills?: string[]
): void {
  const provider = settings.provider || 'unknown'
  const model = settings.model || 'unknown'
  const timestamp = formatLogTimestamp()
  const skillLine = usedSkills?.length ? `技能: ${usedSkills.join(', ')}` : ''
  const content = [
    '',
    `===== AI 提示词 ${label} =====`,
    `时间: ${timestamp}`,
    `任务: ${taskName}`,
    `提供者: ${provider}`,
    `模型: ${model}`,
    skillLine,
    '--- SYSTEM ---',
    prompt.system || '',
    '--- USER ---',
    prompt.user || '',
    `===== END AI 提示词 ${label} =====`
  ].filter(Boolean).join('\n')

  console.log(`[ai] prompt logged: ${label} | task=${taskName} | provider=${provider} | model=${model}`)
  void writePromptLogFile(content)
}

/**
 * Log the matcher selection: which skills were picked (with score) and which
 * knowledge items were retrieved. Written before the REQUEST block so a reader
 * sees SELECTION → REQUEST → RESPONSE in chronological order.
 */
export function logSelection(
  taskName: string,
  skills: SkillSelection[],
  knowledge: AiRunKnowledgeItem[]
): void {
  const timestamp = formatLogTimestamp()
  const skillLines = skills.length
    ? skills.map((s, i) => {
        const b = s.scoreBreakdown
        const detail = b
          ? ` [task=${b.task} stage=${b.stage} trig=${b.trigger} narr=${b.narrative} len=${b.length} prio=${b.priority.toFixed(1)}]`
          : ''
        return `  ${i + 1}. ${s.id} (score=${s.score.toFixed(1)}${detail}, refs=${s.referenceContents.length}, content=${s.content.length}字)`
      })
    : ['  （无）']
  const knowledgeLines = knowledge.length
    ? knowledge.map((k, i) => {
        const snippet = (k.snippet || '').replace(/\s+/g, ' ').slice(0, 80)
        const kw = k.keywords.length ? ` [${k.keywords.slice(0, 5).join('、')}]` : ''
        return `  ${i + 1}. [${k.sourceType}] ${k.title} <- ${k.sourceLabel}${kw}\n     ${snippet}`
      })
    : ['  （无）']
  const content = [
    '',
    `===== AI 选择 SELECTION =====`,
    `时间: ${timestamp}`,
    `任务: ${taskName}`,
    '--- 选中的 SKILL ---',
    ...skillLines,
    '--- 检索到的知识 ---',
    ...knowledgeLines,
    `===== END AI 选择 =====`
  ].join('\n')

  console.log(`[ai] selection: task=${taskName} | skills=${skills.length} | knowledge=${knowledge.length}`)
  void writePromptLogFile(content)
}

/**
 * Log the raw response text from the model along with timing. Written after
 * the model call returns (success path).
 */
export function logResponse(
  label: string,
  settings: AppSettings,
  taskName: string,
  rawText: string,
  durationMs: number,
  extra?: { usedSkills?: string[] }
): void {
  const provider = settings.provider || 'unknown'
  const model = settings.model || 'unknown'
  const timestamp = formatLogTimestamp()
  const skillLine = extra?.usedSkills?.length ? `技能: ${extra.usedSkills.join(', ')}` : ''
  const previewSource = (rawText || '').replace(/\s+/g, ' ').trim()
  const preview = previewSource.length > 200 ? `${previewSource.slice(0, 200)}…` : previewSource
  const content = [
    '',
    `===== AI 响应 ${label} =====`,
    `时间: ${timestamp}`,
    `任务: ${taskName}`,
    `提供者: ${provider}`,
    `模型: ${model}`,
    `耗时: ${durationMs}ms`,
    `字数: ${rawText.length}`,
    skillLine,
    '--- BODY ---',
    rawText || '（空响应）',
    `===== END AI 响应 ${label} =====`
  ].filter(Boolean).join('\n')

  console.log(`[ai] response: ${label} | task=${taskName} | provider=${provider} | model=${model} | ${durationMs}ms | ${rawText.length}字 | ${preview}`)
  void writePromptLogFile(content)
}

/**
 * Log an AI call failure. Mirrors logResponse layout so prompt → error pairs are
 * obvious in the log file. Called from orchestrator / agent catch blocks; without
 * this, failed runs leave a REQUEST entry with no matching RESPONSE and the user
 * has no way to see what went wrong.
 */
export function logError(
  label: string,
  settings: AppSettings,
  taskName: string,
  error: unknown,
  durationMs: number,
  extra?: { usedSkills?: string[] }
): void {
  const provider = settings.provider || 'unknown'
  const model = settings.model || 'unknown'
  const timestamp = formatLogTimestamp()
  const skillLine = extra?.usedSkills?.length ? `技能: ${extra.usedSkills.join(', ')}` : ''
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error && error.stack ? error.stack : ''
  const details = formatErrorDetails(error)
  const content = [
    '',
    `===== AI 错误 ${label} =====`,
    `时间: ${timestamp}`,
    `任务: ${taskName}`,
    `提供者: ${provider}`,
    `模型: ${model}`,
    `耗时: ${durationMs}ms`,
    skillLine,
    '--- ERROR ---',
    message,
    details ? '--- DETAILS ---' : '',
    details,
    stack ? '--- STACK ---' : '',
    stack,
    `===== END AI 错误 ${label} =====`
  ].filter(Boolean).join('\n')

  console.error(`[ai] error: ${label} | task=${taskName} | provider=${provider} | model=${model} | ${durationMs}ms | ${message}${details ? ` | ${details}` : ''}`)
  void writePromptLogFile(content)
}

function formatErrorDetails(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return ''
  }

  const record = error as Record<string, unknown>
  const lines: string[] = []
  const errorName = error instanceof Error ? error.name : ''
  if (errorName) {
    lines.push(`errorName: ${errorName}`)
  }

  const errorFields = Object.keys(record).sort()
  if (errorFields.length) {
    lines.push(`errorFields: ${errorFields.join(', ')}`)
  }

  const statusCode = record.statusCode
  if (typeof statusCode === 'number' || typeof statusCode === 'string') {
    lines.push(`statusCode: ${statusCode}`)
  }

  if (typeof record.isRetryable === 'boolean') {
    lines.push(`isRetryable: ${record.isRetryable}`)
  }

  if (typeof record.url === 'string' && record.url.trim()) {
    lines.push(`url: ${sanitizeErrorUrl(record.url)}`)
  }

  const responseHeaders = formatResponseHeaders(record.responseHeaders)
  if (responseHeaders) {
    lines.push(`responseHeaders: ${responseHeaders}`)
  }

  const requestBodySummary = formatRequestBodySummary(record.requestBodyValues)
  if (requestBodySummary) {
    lines.push(`requestBodySummary: ${requestBodySummary}`)
  }

  const responseBody = record.responseBody
  if (typeof responseBody === 'string' && responseBody.trim()) {
    lines.push(`responseBody: ${truncateErrorDetail(responseBody)}`)
  }

  const data = record.data
  if (data !== undefined) {
    lines.push(`data: ${truncateErrorDetail(safeStringify(data))}`)
  }

  const cause = record.cause
  if (cause && typeof cause === 'object' && cause !== error) {
    const causeDetails = formatErrorDetails(cause)
    if (causeDetails) {
      lines.push(`cause: ${causeDetails}`)
    }
  }

  return lines.join('\n')
}

const MAX_ERROR_DETAIL_LENGTH = 16000

function truncateErrorDetail(value: string): string {
  return value.length > MAX_ERROR_DETAIL_LENGTH
    ? `${value.slice(0, MAX_ERROR_DETAIL_LENGTH)}...（已截断）`
    : value
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function sanitizeErrorUrl(value: string): string {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.split(/[?#]/, 1)[0]
  }
}

function formatResponseHeaders(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ''
  }

  const sensitiveHeaders = /^(authorization|cookie|proxy-authenticate|proxy-authorization|set-cookie|www-authenticate)$/i
  const headers = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, headerValue]) => [name, sensitiveHeaders.test(name) ? '[REDACTED]' : String(headerValue)])
  )
  return truncateErrorDetail(safeStringify(headers))
}

function formatRequestBodySummary(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ''
  }

  const body = value as Record<string, unknown>
  const messages = Array.isArray(body.messages) ? body.messages : []
  const input = Array.isArray(body.input) ? body.input : []
  const summary = {
    fields: Object.keys(body).sort(),
    model: body.model,
    stream: body.stream,
    maxTokens: body.max_tokens,
    maxCompletionTokens: body.max_completion_tokens,
    maxOutputTokens: body.max_output_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    responseFormat: body.response_format && typeof body.response_format === 'object'
      ? (body.response_format as Record<string, unknown>).type
      : body.response_format,
    messageCount: messages.length,
    messageRoles: messages.map((message) =>
      message && typeof message === 'object' ? (message as Record<string, unknown>).role : undefined
    ),
    inputCount: input.length,
    inputRoles: input.map((item) =>
      item && typeof item === 'object' ? (item as Record<string, unknown>).role : undefined
    ),
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0
  }
  return truncateErrorDetail(safeStringify(summary))
}
