import type { AiTaskName, AiTaskResult, PromptPair, AiTaskKnowledgeContext } from '../shared-types'
import type { PromptCapabilityId } from '../prompts/capability'
import type { SkillSelection } from '../skills/types'

export type PromptBuildInput = {
  context: Record<string, unknown>
  skills: SkillSelection[]
  knowledgeContext?: AiTaskKnowledgeContext
  capabilityPreamble: PromptPair
  skillsBlock: string
  knowledgeBlock: string
}

export interface TaskHandler {
  name: AiTaskName
  outputType: 'json' | 'text'
  defaultCapabilities: PromptCapabilityId[]
  buildPrompt(input: PromptBuildInput): PromptPair
  normalize(raw: string): AiTaskResult
  validate(result: AiTaskResult): boolean
  resolveMaxTokens?(input: PromptBuildInput): number
  /**
   * 本任务最多可使用的 skill 数量。默认 4。
   * 复杂任务（如 chapter-first-draft）可设为 6，让更多维度的 skill 参与。
   */
  maxSkills?: number
}

function sanitizeJsonText(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/[\x00-\x1f]/g, (ch) => (ch === '\n' || ch === '\r' || ch === '\t' ? ch : ''))
}

function tryParseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      const first = parsed.find((item) => item && typeof item === 'object' && !Array.isArray(item))
      return (first as Record<string, unknown>) ?? null
    }
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function salvageTruncatedJsonObject(text: string): Record<string, unknown> | null {
  const firstBrace = text.indexOf('{')
  if (firstBrace < 0) return null

  const source = text.slice(firstBrace)
  const checkpoints: Array<{ index: number; closers: string[] }> = []
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      stack.push('}')
      continue
    }

    if (ch === '[') {
      stack.push(']')
      continue
    }

    if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) {
        stack.pop()
      }
      checkpoints.push({ index: index + 1, closers: [...stack].reverse() })
      continue
    }

    if (ch === ',') {
      checkpoints.push({ index: index + 1, closers: [...stack].reverse() })
    }
  }

  for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
    const checkpoint = checkpoints[index]
    const candidate = sanitizeJsonText(`${source.slice(0, checkpoint.index)}${checkpoint.closers.join('')}`)
    const parsed = tryParseJsonRecord(candidate)
    if (parsed) {
      return parsed
    }
  }

  const closingSuffix = [...stack].reverse().join('')
  if (inString) {
    const parsed = tryParseJsonRecord(sanitizeJsonText(`${source}"${closingSuffix}`))
    if (parsed) {
      return parsed
    }
  }

  if (closingSuffix) {
    return tryParseJsonRecord(sanitizeJsonText(`${source}${closingSuffix}`))
  }

  return null
}

export function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const raw = fenced?.[1] ?? text

  const firstBrace = raw.indexOf('{')
  const firstBracket = raw.indexOf('[')
  const jsonStart = firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
    ? firstBrace
    : firstBracket
  const closingChar = jsonStart >= 0 && raw[jsonStart] === '[' ? ']' : '}'
  const lastClose = raw.lastIndexOf(closingChar)
  const jsonSlice = jsonStart >= 0 && lastClose >= jsonStart ? raw.slice(jsonStart, lastClose + 1) : raw

  const direct = tryParseJsonRecord(jsonSlice)
  if (direct) {
    return direct
  }

  const repaired = sanitizeJsonText(jsonSlice)
  const repairedParsed = tryParseJsonRecord(repaired)
  if (repairedParsed) {
    return repairedParsed
  }

  const salvaged = salvageTruncatedJsonObject(repaired)
  if (salvaged) {
    return salvaged
  }

  throw new Error('AI 返回的 JSON 不完整或格式错误。')
}

export function normalizeAssistantText(text: string): { content: string } {
  const cleaned = text
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .trim()
  return { content: cleaned }
}
