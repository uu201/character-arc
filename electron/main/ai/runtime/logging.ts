import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings, AiRunKnowledgeItem, PromptPair } from '../shared-types'
import type { SkillSelection } from '../skills/types'

const AI_PROMPT_LOG_DIR = join(process.cwd(), '.logs')
const AI_PROMPT_LOG_FILE = join(AI_PROMPT_LOG_DIR, 'ai-prompts.log')

async function writePromptLogFile(content: string): Promise<void> {
  try {
    await mkdir(AI_PROMPT_LOG_DIR, { recursive: true })
    await appendFile(AI_PROMPT_LOG_FILE, `${content}\n`, 'utf8')
  } catch (error) {
    console.error('[ai] failed to write prompt log file:', error)
  }
}

export function logPrompt(
  label: string,
  settings: AppSettings,
  prompt: PromptPair,
  taskName: string,
  usedSkills?: string[]
): void {
  const provider = settings.provider || 'unknown'
  const model = settings.model || 'unknown'
  const timestamp = new Date().toISOString()
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
  const timestamp = new Date().toISOString()
  const skillLines = skills.length
    ? skills.map((s, i) => `  ${i + 1}. ${s.id} (score=${s.score}, refs=${s.referenceContents.length}, content=${s.content.length}字)`)
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
  const timestamp = new Date().toISOString()
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
  const timestamp = new Date().toISOString()
  const skillLine = extra?.usedSkills?.length ? `技能: ${extra.usedSkills.join(', ')}` : ''
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error && error.stack ? error.stack : ''
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
    stack ? '--- STACK ---' : '',
    stack,
    `===== END AI 错误 ${label} =====`
  ].filter(Boolean).join('\n')

  console.error(`[ai] error: ${label} | task=${taskName} | provider=${provider} | model=${model} | ${durationMs}ms | ${message}`)
  void writePromptLogFile(content)
}
