export type TextWindow = {
  text: string
  total: number
  offset: number
  limit: number
  end: number
  truncated: boolean
  nextOffset?: number
}

export function sliceTextWindow(
  value: string,
  options: {
    offset?: unknown
    limit?: unknown
    defaultLimit?: number
    maxLimit?: number
  } = {}
): TextWindow {
  const defaultLimit = options.defaultLimit ?? 15000
  const maxLimit = options.maxLimit ?? 30000
  const offset = normalizeNonNegativeInteger(options.offset, 0)
  const limit = Math.max(1, Math.min(normalizeNonNegativeInteger(options.limit, defaultLimit), maxLimit))
  const total = value.length
  const start = Math.min(offset, total)
  const end = Math.min(start + limit, total)
  const truncated = end < total

  return {
    text: value.slice(start, end),
    total,
    offset: start,
    limit,
    end,
    truncated,
    ...(truncated ? { nextOffset: end } : {})
  }
}

export function formatTextWindowNote(window: TextWindow, label = 'Content', nextOffsetParam = 'content_offset'): string {
  if (window.total === 0) return `(${label} is empty.)`
  if (window.offset >= window.total) {
    return `(${label} offset ${window.offset} is at the end of ${window.total} chars.)`
  }

  const range = `${window.offset + 1}-${window.end}`
  const suffix = window.truncated
    ? ` Next ${nextOffsetParam}: ${window.nextOffset}.`
    : ' End of content.'
  return `(${label} chars ${range} of ${window.total}.${suffix})`
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}
