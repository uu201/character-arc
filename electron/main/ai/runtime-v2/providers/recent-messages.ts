/**
 * recent-messages · 最近的 turn 对话（用户输入 + 助手回复）。
 *
 * 让 AI 感知本会话的历史上下文；不是无限历史，只取最近 N 条。
 * 依赖 ConversationManager 而非 workspace snapshot。
 */

import type {
  ContextBuildRequest,
  ContextSlice
} from '@shared/assistant-runtime'
import type { ContextProvider } from '../context-builder'
import type { ConversationManager } from '../conversation-manager'
import { makeSlice } from './shared'

const MAX_TURNS = 6
const MSG_LIMIT = 400

function trim(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export function makeRecentMessagesProvider(
  getConversation: () => Promise<ConversationManager>
): ContextProvider {
  return {
    id: 'recent-messages',
    priority: 80,
    truncationHint: '最近对话历史因预算受限省略。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const cm = await getConversation()
      const turns = cm.listTurns(request.sessionId)
      // 排除当前正在执行的 turn（status='streaming'），只保留 done 状态的历史
      const history = turns
        .filter((t) => t.status === 'done')
        .slice(-MAX_TURNS)
      if (history.length === 0) return null

      const lines: string[] = []
      for (const turn of history) {
        lines.push(`**用户**：${trim(turn.userMessage, MSG_LIMIT)}`)
        if (turn.assistantMessage) {
          lines.push(`**助理**：${trim(turn.assistantMessage, MSG_LIMIT)}`)
        }
        lines.push('')
      }

      return makeSlice(
        'recent-messages',
        80,
        `最近对话（共 ${history.length} 轮）`,
        lines.join('\n').trim()
      )
    }
  }
}
