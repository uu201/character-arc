import type { AiAgentStreamHandlers, AiTaskPayload, AiTaskResponse } from '../shared-types'
import { normalizeSettings, validateSettings, resolveMaxTokens } from '../settings'
import { getTaskHandler } from '../tasks'
import { pickSkillsFor, refreshRegistry, getSkillById } from '../skills'
import { buildPromptInput } from '../runtime/context-builder'
import { buildRunMeta, buildResponsePreview } from '../runtime/run-meta'
import { logPrompt, logResponse, logError } from '../runtime/logging'
import { runStreamingAgentLoop } from './streaming-loop'
import { createSkillTools } from './tools/skill-tools'
import { createChapterTools } from './tools/chapter-tools'
import { createToolRegistry } from './tools/registry'
import { buildAgentBehaviorRules, buildSkillIndex } from './system-prompt'
import type { AiTaskKnowledgeContext } from '../shared-types'

function stripSkillFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return content
  return content.slice(match[0].length)
}

export async function runStreamingAgentTask(
  task: AiTaskPayload,
  handlers: AiAgentStreamHandlers,
  signal: AbortSignal,
  knowledgeContext?: AiTaskKnowledgeContext
): Promise<AiTaskResponse> {
  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const startedAt = new Date().toISOString()
  const projectId = String(task.context.projectId ?? '').trim()
  const chapterId = String(task.context.chapterId ?? '').trim() || undefined

  const handler = getTaskHandler(task.task)
  await refreshRegistry(projectId || undefined).catch(() => {})

  const candidateSkills = await pickSkillsFor(task)
  const usedSkillIds = candidateSkills.map((s) => s.id)

  const input = buildPromptInput(task, candidateSkills, knowledgeContext)
  const prompt = handler.buildPrompt(input)
  const maxTokens = handler.resolveMaxTokens?.(input) ?? resolveMaxTokens(task)

  const candidateSkillDefs = candidateSkills
    .map((sel) => getSkillById(sel.id, projectId || undefined))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  const requiredSkillDefs = candidateSkillDefs.filter((s) => s.manifest.required)
  const optionalSkillDefs = candidateSkillDefs.filter((s) => !s.manifest.required)

  const requiredSkillBlock = requiredSkillDefs.length
    ? `\n\n## 强制生效的 SKILLS\n\n${requiredSkillDefs.map((s) => {
        const body = stripSkillFrontmatter(s.content).trim().slice(0, 2000)
        return `### ${s.name}\n${body}`
      }).join('\n\n')}`
    : ''

  const chapterToolsBlock = [
    '',
    '## 章节编辑工具',
    '',
    '你可以使用以下工具直接操作章节内容：',
    '- `read_chapter`: 读取章节内容和元数据',
    '- `edit_chapter`: 直接编辑章节正文（替换/插入/追加）',
    '- `search_project`: 搜索项目中的世界观、角色、大纲等资料',
    '- `list_chapters`: 获取所有章节列表',
    '',
    '当用户要求修改正文时，优先使用 edit_chapter 工具直接修改，而不是只给出建议文本。',
    '修改前可以先用 read_chapter 读取当前内容，确认要修改的位置。'
  ].join('\n')

  const systemPrompt = `${prompt.system}${requiredSkillBlock}${chapterToolsBlock}\n${buildSkillIndex(optionalSkillDefs)}\n${buildAgentBehaviorRules()}`

  const skillTools = createSkillTools({
    resolveSkill: (id) => getSkillById(id, projectId || undefined),
    allowScriptExecution: (skill) => skill.scope === 'builtin'
  })

  const chapterTools = createChapterTools({
    currentChapterId: chapterId || '',
    onEditApplied: handlers.onEditApplied
  })

  const registry = createToolRegistry([...skillTools, ...chapterTools])

  logPrompt('AGENT_STREAM', settings, { system: systemPrompt, user: prompt.user }, task.task, usedSkillIds)
  const requestStartedAt = Date.now()

  try {
    const loopResult = await runStreamingAgentLoop({
      settings,
      systemPrompt,
      userPrompt: prompt.user,
      registry,
      ctx: { signal, projectId },
      handlers,
      maxTokens
    })

    logResponse('AGENT_STREAM', settings, task.task, loopResult.finalText, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })

    const result = handler.normalize(loopResult.finalText)
    const finishedAt = new Date().toISOString()
    const meta = buildRunMeta(
      task.task, projectId, chapterId, settings, 'success',
      startedAt, finishedAt,
      knowledgeContext?.usedKnowledge ?? [], usedSkillIds,
      false, buildResponsePreview(result), ''
    )
    meta.toolCalls = loopResult.toolCalls
    meta.agentIterations = loopResult.iterations

    return { result, meta }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : 'AI Agent 调用失败'
    logError('AGENT_STREAM', settings, task.task, error, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })
    const meta = buildRunMeta(
      task.task, projectId, chapterId, settings, 'error',
      startedAt, finishedAt,
      knowledgeContext?.usedKnowledge ?? [], usedSkillIds,
      false, '', message
    )
    throw Object.assign(new Error(message), { aiRunMeta: meta })
  }
}
