import type { ContextBuildRequest, ContextSlice } from '@shared/assistant-runtime'
import type { ContextProvider } from '../context-builder'
import type { AgentMemoryStore } from '../agent-memory-store'
import { formatAgentMemories } from '../agent-memory-store'
import { makeSlice } from './shared'

const MAX_INJECTED_MEMORIES = 12

export function makeAgentMemoriesProvider(
  getStore: () => Promise<AgentMemoryStore>
): ContextProvider {
  return {
    id: 'agent-memories',
    priority: 96,
    truncationHint: '长期记忆已因上下文预算省略；需要时可让用户在“智能体能力”中查看。',
    isApplicable(surface) {
      return surface.scope !== 'selection'
    },
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const store = await getStore()
      const body = formatAgentMemories(store.list(request.projectId, MAX_INJECTED_MEMORIES))
      return body ? makeSlice('agent-memories', 96, '项目长期记忆', body) : null
    }
  }
}
