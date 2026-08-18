import type { AgentMemoryKind } from '@shared/assistant-runtime'
import type { Tool, ToolHandlerResult } from '../../agent/tools/types'
import type { AgentMemoryStore } from '../agent-memory-store'

const VALID_KINDS = new Set<AgentMemoryKind>(['preference', 'lesson', 'fact', 'method'])
const EXPLICIT_MEMORY_REQUEST = /(记住|记下来|以后都|以后不要|长期偏好|我的偏好|别再|不要再|固定规则)/

export function createControlledMemoryTools(options: {
  store: AgentMemoryStore
  projectId: string
  turnId: string
  userMessage: string
}): Tool[] {
  const save: Tool = {
    definition: {
      name: 'memory_save',
      description: '仅当用户本轮明确要求“记住/以后遵守/不要再犯”时，保存一条项目级长期创作记忆。临时计划、模型推测和未经用户确认的结论不得保存。',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['preference', 'lesson', 'fact', 'method'] },
          content: { type: 'string', description: '简洁、自包含且得到用户明确授权的长期记忆。' },
          importance: { type: 'number', description: '重要度 1~5，默认 3。' }
        },
        required: ['content']
      }
    },
    handler: async (input): Promise<ToolHandlerResult> => {
      if (!EXPLICIT_MEMORY_REQUEST.test(options.userMessage.replace(/\s+/g, ''))) {
        return {
          content: '本轮用户没有明确要求形成长期记忆。请先在回复中建议，由用户确认后再保存。',
          isError: true
        }
      }
      const content = String(input.content ?? '').trim()
      if (!content) return { content: 'memory_save 缺少 content。', isError: true }
      const rawKind = String(input.kind ?? 'preference') as AgentMemoryKind
      const memory = options.store.create({
        projectId: options.projectId,
        kind: VALID_KINDS.has(rawKind) ? rawKind : 'preference',
        content,
        source: 'agent',
        importance: Number(input.importance ?? 3),
        sourceTurnId: options.turnId
      })
      return { content: `已保存长期记忆：${memory.content}` }
    }
  }

  return [save]
}
