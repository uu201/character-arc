const MAX_ERROR_DETAIL_LENGTH = 1200

type ErrorRecord = Record<string, unknown>

function asRecord(value: unknown): ErrorRecord | null {
  return value && typeof value === 'object' ? value as ErrorRecord : null
}

function trimDetail(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_ERROR_DETAIL_LENGTH) return normalized
  return `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`
}

function parseBody(value: unknown): string {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    try {
      return parseBody(JSON.parse(text)) || trimDetail(text)
    } catch {
      return trimDetail(text)
    }
  }

  const record = asRecord(value)
  if (!record) return ''

  for (const key of ['error', 'message', 'detail', 'msg', 'description']) {
    const nested = record[key]
    if (typeof nested === 'string' && nested.trim()) return trimDetail(nested)
    const nestedMessage = parseBody(nested)
    if (nestedMessage) return nestedMessage
  }

  try {
    return trimDetail(JSON.stringify(record))
  } catch {
    return ''
  }
}

function findResponseBody(error: unknown): unknown {
  let current: unknown = error
  const visited = new Set<unknown>()
  for (let depth = 0; depth < 4 && current && !visited.has(current); depth += 1) {
    visited.add(current)
    const record = asRecord(current)
    if (!record) return undefined
    for (const key of ['responseBody', 'response_body', 'data', 'body']) {
      if (record[key] !== undefined && record[key] !== null) return record[key]
    }
    current = record.cause
  }
  return undefined
}

/**
 * Preserve the upstream API message when AI SDK only exposes a generic status
 * text such as "Not Found". This is the user-facing error string; raw details
 * remain available in ai-prompts.log for diagnostics.
 */
export function formatAiErrorMessage(error: unknown, fallback: string): string {
  const record = asRecord(error)
  const statusCode = record?.statusCode ?? asRecord(record?.cause)?.statusCode
  const upstreamDetail = parseBody(findResponseBody(error))
  const baseMessage = error instanceof Error ? error.message.trim() : String(error ?? '').trim()
  const genericMessages = new Set(['not found', 'bad request', 'unauthorized', 'forbidden', 'internal server error'])

  if (upstreamDetail && upstreamDetail.toLowerCase() !== baseMessage.toLowerCase()) {
    const status = statusCode ? `（HTTP ${statusCode}）` : ''
    return `接口返回${status}：${upstreamDetail}`
  }

  if (baseMessage && baseMessage !== fallback) {
    const status = statusCode && genericMessages.has(baseMessage.toLowerCase()) ? `（HTTP ${statusCode}）` : ''
    return `${baseMessage}${status}`
  }

  return fallback
}
