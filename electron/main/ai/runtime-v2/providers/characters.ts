/**
 * characters · 人物卡摘要。
 */

import type {
  ContextBuildRequest,
  ContextSlice
} from '@shared/assistant-runtime'
import type { ContextProvider } from '../context-builder'
import { getProjectView, makeSlice, type SnapshotAccessor } from './shared'

const DESC_LIMIT = 400
const MAX_CHARACTERS = 12

export function makeCharactersProvider(
  accessor: SnapshotAccessor
): ContextProvider {
  return {
    id: 'characters',
    priority: 55,
    truncationHint:
      '人物卡因预算受限省略。相关问题请调用 search_project(scope=["characters"]) 或 read_project_data(entity_type="characters")。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view || view.workspace.characters.length === 0) return null

      const characters = view.workspace.characters
      const shown = characters.slice(0, MAX_CHARACTERS)
      const remaining = characters.length - shown.length

      const lines = shown.map((c) => {
        const desc = c.description.length > DESC_LIMIT
          ? `${c.description.slice(0, DESC_LIMIT)}…`
          : c.description
        const tags = c.tags.length > 0
          ? `  · 标签：${c.tags.map((t) => t.label).join(' / ')}`
          : ''
        const role = c.role ? `（${c.role}）` : ''
        return `- **${c.name}**${role}：${desc}${tags}`
      })

      if (remaining > 0) {
        lines.push(
          `\n（还有 ${remaining} 位人物未展开。如需详情，调用 search_project 或 read_project_data。）`
        )
      }

      return makeSlice('characters', 55, '人物卡', lines.join('\n'))
    }
  }
}
