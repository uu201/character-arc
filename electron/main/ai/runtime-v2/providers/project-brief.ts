/**
 * project-brief · 项目基本资料。
 * 所有 Surface 通用、最高优先级（永远保留）。
 */

import type {
  ContextBuildRequest,
  ContextSlice
} from '@shared/assistant-runtime'
import type { ContextProvider } from '../context-builder'
import { getProjectView, makeSlice, type SnapshotAccessor } from './shared'

export function makeProjectBriefProvider(
  accessor: SnapshotAccessor
): ContextProvider {
  return {
    id: 'project-brief',
    priority: 100,
    truncationHint:
      '项目基本资料因预算受限省略。若需要项目题材、字数目标等，请调用 read_project_data(entity_type="projects")。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view) return null
      const { project } = view

      const lines: string[] = []
      lines.push(`- 标题：${project.title}`)
      if (project.genre) lines.push(`- 题材：${project.genre}`)
      if (project.wordCount) lines.push(`- 字数目标：${project.wordCount}`)
      if (project.targetPlatform) lines.push(`- 目标平台：${project.targetPlatform}`)
      if (project.writingStylePrompt) {
        lines.push(`- 写作风格：${project.writingStylePrompt.slice(0, 240)}`)
      }

      return makeSlice(
        'project-brief',
        100,
        '项目概览',
        lines.join('\n')
      )
    }
  }
}
