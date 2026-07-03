/**
 * worldview · 项目世界观条目摘要。
 * 中优先级。数量多、单条内容长时容易溢出预算，priority 稍低于 project-brief。
 */

import type {
  ContextBuildRequest,
  ContextSlice
} from '@shared/assistant-runtime'
import type { ContextProvider } from '../context-builder'
import { getProjectView, makeSlice, type SnapshotAccessor } from './shared'

/** 单条 content 摘要上限。长上下文模式下尽量保留更多设定，最终由 ContextBuilder 压缩兜底。 */
const ENTRY_CONTENT_LIMIT = 1500
/** 最多列出条目数。超过则提示可调 search_project 精读。 */
const MAX_ENTRIES = 80

export function makeWorldviewProvider(
  accessor: SnapshotAccessor
): ContextProvider {
  return {
    id: 'worldview',
    priority: 60,
    truncationHint:
      '世界观条目因预算受限省略。相关问题请调用 search_project(query=..., scope=["worldview"]) 或 read_project_data(entity_type="worldview")。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view || view.workspace.worldviewEntries.length === 0) return null

      const entries = view.workspace.worldviewEntries
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const shown = entries.slice(0, MAX_ENTRIES)
      const remaining = entries.length - shown.length

      const lines = shown.map((entry) => {
        const content = entry.content.length > ENTRY_CONTENT_LIMIT
          ? `${entry.content.slice(0, ENTRY_CONTENT_LIMIT)}…`
          : entry.content
        return `- **${entry.title}**（${entry.type}）：${content}`
      })

      if (remaining > 0) {
        lines.push(
          `\n（还有 ${remaining} 条世界观条目未展开。如需详情，调用 search_project 或 read_project_data。）`
        )
      }

      return makeSlice('worldview', 60, '世界观', lines.join('\n'))
    }
  }
}
