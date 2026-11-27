import { randomUUID } from 'node:crypto'
import type { SkillUserInputRequest, SkillUserInputResponse, SkillWorkflowStep, TurnEvent } from '@shared/assistant-runtime'
import type { Tool } from '../agent/tools/types'
import type { ConversationManager } from './conversation-manager'

function text(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}不能为空且不能超过 ${max} 字。`)
  return value.trim()
}

/** 交互工具只记录检查点；真正的读写仍使用当前 Surface 已授权的工具。 */
export function createSkillInteractionTools(deps: {
  goal: string
  isSkillAllowed: (id: string) => boolean
  onQuestion: (request: SkillUserInputRequest) => void
  onStep: (step: SkillWorkflowStep) => void
}): Tool[] {
  const skillId = (input: Record<string, unknown>): string => {
    const id = text(input.skill_id, 'skill_id', 200)
    if (!deps.isSkillAllowed(id)) throw new Error('该 Skill 不在本轮执行计划中。')
    return id
  }
  return [{
    definition: {
      name: 'skill_ask_user',
      description: '技能执行到需要作者决定、选择或补充信息的步骤时使用。展示问题后立即暂停，等待用户回答后再继续；不可自行代选，不可与后续写入并发调用。已明确提供的答案不重复问。',
      inputSchema: { type: 'object', properties: {
        skill_id: { type: 'string' }, step: { type: 'string', description: '当前需要决定的步骤名称' },
        questions: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: {
          id: { type: 'string' }, question: { type: 'string' },
          options: { type: 'array', maxItems: 6, items: { type: 'object', properties: {
            label: { type: 'string' }, description: { type: 'string' }
          }, required: ['label', 'description'] } }
        }, required: ['id', 'question', 'options'] } }
      }, required: ['skill_id', 'step', 'questions'] }
    },
    handler: async (input) => {
      const id = skillId(input)
      if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 4) throw new Error('每次请提出 1–4 个问题。')
      const ids = new Set<string>()
      const questions = input.questions.map((raw: unknown) => {
        if (!raw || typeof raw !== 'object') throw new Error('问题格式无效。')
        const question = raw as Record<string, unknown>
        const questionId = text(question.id, '问题 ID', 100)
        if (ids.has(questionId)) throw new Error('问题 ID 不能重复。')
        ids.add(questionId)
        if (!Array.isArray(question.options) || question.options.length > 6) throw new Error('每个问题最多提供 6 个选项；无选项时传空数组。')
        return { id: questionId, question: text(question.question, '问题'), options: question.options.map((rawOption: unknown) => {
          if (!rawOption || typeof rawOption !== 'object') throw new Error('选项格式无效。')
          const option = rawOption as Record<string, unknown>
          return { label: text(option.label, '选项', 200), description: typeof option.description === 'string' ? option.description.slice(0, 1000) : '' }
        }) }
      })
      deps.onQuestion({ id: randomUUID(), skillId: id, step: text(input.step, '步骤', 200), goal: deps.goal, questions })
      return { content: '已向用户提出问题，流程在此暂停。收到真实回答前不要执行后续步骤。' }
    }
  }, {
    definition: {
      name: 'skill_workflow',
      description: '记录技能流程的当前步骤及进度。开始步骤用 running，完成实际工作后用 completed；不要提前标记后续步骤完成。用户需要判断时改用 skill_ask_user 暂停。',
      inputSchema: { type: 'object', properties: {
        skill_id: { type: 'string' }, step_id: { type: 'string', description: '同一步骤更新时沿用相同 ID' },
        title: { type: 'string' }, status: { type: 'string', enum: ['running', 'completed'] }, summary: { type: 'string' }
      }, required: ['skill_id', 'step_id', 'title', 'status'] }
    },
    handler: async (input) => {
      const id = skillId(input)
      if (input.status !== 'running' && input.status !== 'completed') throw new Error('步骤状态必须为 running 或 completed。')
      deps.onStep({ skillId: id, id: text(input.step_id, '步骤 ID', 100), title: text(input.title, '步骤名称', 200), status: input.status,
        summary: typeof input.summary === 'string' ? input.summary.slice(0, 2000) : undefined })
      return { content: `已记录步骤：${input.title}（${input.status === 'completed' ? '已完成' : '进行中'}）。` }
    }
  }]
}

/** 使用持久化事件恢复流程，拒绝跨会话、过期及重复提交的问题。 */
export function resolveSkillUserInput(conversation: Pick<ConversationManager, 'getTurn' | 'listEvents'>, sessionId: string, response: SkillUserInputResponse) {
  const turn = conversation.getTurn(text(response.turnId, '原轮次 ID', 200))
  if (!turn || turn.sessionId !== sessionId || turn.status !== 'done') throw new Error('该问题不属于当前会话或尚未就绪。')
  const events = conversation.listEvents(turn.id).map((event) => JSON.parse(event.payloadJson) as TurnEvent)
  const request = events.filter((event) => event.kind === 'user_input_requested').at(-1)?.request
  if (!request || request.id !== response.requestId) throw new Error('问题已过期，请刷新会话。')
  if (events.some((event) => event.kind === 'user_input_answered' && event.requestId === request.id)) throw new Error('该问题已经提交过答案。')
  if (!response.answers || typeof response.answers !== 'object' || Array.isArray(response.answers)) throw new Error('回答格式无效。')
  const answers = Object.fromEntries(request.questions.map((question) => [question.id, text(response.answers[question.id], `「${question.question}」的回答`)]))
  const decisions = [...(request.decisions ?? []), ...request.questions.map((question) => ({ question: question.question, answer: answers[question.id] }))]
  const lines = decisions.map((decision) => `${decision.question}\n用户回答：${decision.answer}`)
  const plan = events.filter((event) => event.kind === 'skill_plan').at(-1)
  const skillIds = [...new Set([...(plan?.items.map((item) => item.id) ?? []), request.skillId])]
  const steps = new Map((request.steps ?? []).map((step) => [`${step.skillId}:${step.id}`, step]))
  for (const event of events) if (event.kind === 'skill_workflow') steps.set(`${event.step.skillId}:${event.step.id}`, event.step)
  const context = [
    '## 继续被用户选择暂停的技能流程', `原始目标：${request.goal}`, `技能：${request.skillId}；暂停步骤：${request.step}`,
    `步骤记录：${JSON.stringify([...steps.values()])}`, ...lines,
    '以上为用户已实际提交的决定。沿用该选择从暂停处继续，不重复询问已经确认的问题；如下一阶段仍需作者判断，再使用 skill_ask_user。'
  ].join('\n\n')
  return { request, answers, context, decisions, steps: [...steps.values()], skillPolicy: { mode: 'only' as const, skillIds } }
}
