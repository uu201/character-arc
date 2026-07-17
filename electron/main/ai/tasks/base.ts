import type { AiTaskName, AiTaskResult, PromptPair, AiTaskKnowledgeContext } from '../shared-types'
import type { PromptCapabilityId } from '../prompts/capability'
import type { SkillSelection } from '../skills/types'

/**
 * 构建 AI Prompt 时的输入参数集。
 * 由 orchestrator 在运行任务前组装，传给 TaskHandler.buildPrompt。
 */
export type PromptBuildInput = {
  /** 任务上下文（用户输入、章节信息等） */
  context: Record<string, unknown>
  /** 本次选中的 skill 列表 */
  skills: SkillSelection[]
  /** 可选的知识库检索结果 */
  knowledgeContext?: AiTaskKnowledgeContext
  /** 由 capability 模块组装的前置提示词对 */
  capabilityPreamble: PromptPair
  /** skills 格式化后的文本块 */
  skillsBlock: string
  /** 知识上下文格式化后的文本块 */
  knowledgeBlock: string
}

/**
 * 任务处理器接口。每种 AI 任务（如世界观生成、大纲批量等）实现此接口。
 * orchestrator 通过此接口统一调度 prompt 构建、结果解析与校验。
 */
export interface TaskHandler {
  /** 任务标识名 */
  name: AiTaskName
  /** AI 返回格式：JSON 或纯文本 */
  outputType: 'json' | 'text'
  /** 本任务默认启用的 prompt capability 列表 */
  defaultCapabilities: PromptCapabilityId[]
  /** 是否参与项目 skills 匹配。纯结构化规划任务可关闭，避免流程型 skills 干扰输出。 */
  useSkills?: boolean
  /** 根据输入构建 system + user prompt 对 */
  buildPrompt(input: PromptBuildInput): PromptPair
  /** 将 AI 原始输出解析为结构化结果 */
  normalize(raw: string, context?: Record<string, unknown>): AiTaskResult
  /** 校验解析后的结果是否符合预期结构 */
  validate(result: AiTaskResult): boolean
  /**
   * 可选：返回具体的校验失败原因列表。
   * 如果实现了此方法，repair prompt 会附上这些信息帮助模型精准修复。
   * 未实现时 orchestrator 会回退到通用的"结构不完整"提示。
   */
  describeValidationErrors?(result: AiTaskResult): string[]
  resolveMaxTokens?(input: PromptBuildInput): number | undefined
  /**
   * 本任务最多可使用的 skill 数量。默认 4。
   * 复杂任务（如 chapter-first-draft）可设为 6，让更多维度的 skill 参与。
   */
  maxSkills?: number
}

/**
 * 清洗 JSON 文本：去除尾部逗号、行内注释和非法控制字符。
 */
function sanitizeJsonText(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/[\x00-\x1f]/g, (ch) => (ch === '\n' || ch === '\r' || ch === '\t' ? ch : ''))
}

/**
 * 尝试将文本解析为 JSON 对象。若解析结果是数组则取首个对象元素。
 * 解析失败返回 null，不抛错。
 */
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

/**
 * 对截断的 JSON 做尽力恢复：从末尾向前寻找最近的合法闭合点，
 * 补齐缺失的括号后尝试解析。
 */
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

/**
 * 从 AI 输出中提取 JSON 对象。
 * 支持从 markdown 代码块中提取，自动修复常见格式问题，截断 JSON 做尽力恢复。
 *
 * @param text - AI 原始输出文本
 * @returns 解析后的 JSON 对象
 * @throws 无法解析时抛出错误
 */
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

/** 将模型返回的基础字段稳定转为字符串，兼容数字等常见 JSON primitive。 */
export function jsonStringField(value: unknown, fallback = ''): string {
  if (value == null) return fallback
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim() || fallback
  }
  return fallback
}

/**
 * 清洗 AI 助手的纯文本输出：去除代码块标记并 trim。
 *
 * @param text - AI 原始输出
 * @returns 包含清洗后 content 的对象
 */
export function normalizeAssistantText(text: string): { content: string } {
  const cleaned = text
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/「/g, '“')
    .replace(/」/g, '”')
    .replace(/『/g, '‘')
    .replace(/』/g, '’')
    .trim()
  return { content: cleaned }
}
