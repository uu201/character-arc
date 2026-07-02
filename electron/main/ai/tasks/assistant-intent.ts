import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, AssistantIntentResult } from '../shared-types'

/** 助手意图路由任务：判断用户请求是普通聊天还是可执行的写作动作 */
const handler: TaskHandler = {
  name: 'assistant-intent',
  outputType: 'json',
  defaultCapabilities: ['settings', 'chapters', 'analysis', 'versioning'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    return {
      system: `${capabilityPreamble.system}\n\n你是小说创作助手的意图路由器。请只返回 JSON 对象，不要返回 Markdown、解释或额外文本。字段必须包含 intent、reason。`,
      user: `${capabilityPreamble.user}\n\n请判断当前用户请求更适合：\n1. 普通聊天回答（chat）\n2. 发起一个可执行的写作动作提议（proposal）\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前选中文本：\n${String(context.selectedText ?? '') || '暂无'}\n快捷动作：${String(context.quickAction ?? '自由提问')}\n用户请求：${String(context.userPrompt ?? '')}\n\n判断规则：\n1. 如果用户是在询问、讨论、要建议、要分析，返回 chat\n2. 如果用户明确要求改写、替换、设为标题/摘要、创建大纲节点、更新创作记忆、写入知识库，返回 proposal\n3. 只能返回 chat 或 proposal 二选一\n4. reason 用一句中文简要说明判断依据，20 到 60 字\n\n返回格式：{"intent":"chat","reason":""}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<AssistantIntentResult>
    return {
      intent: parsed.intent === 'proposal' ? 'proposal' : 'chat',
      reason: String(parsed.reason ?? '').trim() || '当前请求更适合先走普通文本回复。'
    } as AssistantIntentResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as AssistantIntentResult
    return Boolean(r.intent && r.reason?.trim())
  }
}
export default handler
