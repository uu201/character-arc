/** 从兼容接口的 reasoning_details/thinking 字段中提取可读文本。 */
export function extractReasoningText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractReasoningText).filter(Boolean).join('')
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  for (const key of ['text', 'content', 'reasoning', 'reasoning_content', 'summary']) {
    const text = extractReasoningText(record[key])
    if (text) return text
  }
  return ''
}

/** 清理模型把思考过程包在正文中的常见标记。 */
export function stripReasoningMarkup(value: string): string {
  return value
    .replace(/<think(?:ing)?[^>]*>[\s\S]*?<\/(?:think|thinking)>/gi, '')
    .replace(/<analysis[^>]*>[\s\S]*?<\/analysis>/gi, '')
    .replace(/\[think(?:ing)?\][\s\S]*?\[\/(?:think|thinking)\]/gi, '')
    .replace(/\[analysis\][\s\S]*?\[\/analysis\]/gi, '')
    .replace(/^\s*(?:思考过程|分析过程|推理过程)\s*[:：]?\s*[\s\S]*?(?=正文|最终答案|章节正文)[:：]?/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
