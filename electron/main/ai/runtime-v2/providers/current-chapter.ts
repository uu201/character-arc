/**
 * current-chapter · 当前章节正文与元信息。
 * 只在章节相关 Surface 生效（chapter-panel / inline-selection）。
 */

import type {
  ContextBuildRequest,
  ContextSlice,
  SurfaceDefinition
} from '@shared/assistant-runtime'
import type { ContextProvider } from '../context-builder'
import {
  getProjectView,
  makeSlice,
  parseChapterScopeRef,
  surfaceHasChapterScope,
  type SnapshotAccessor
} from './shared'

/** 章节内容截断上限（保守估算 ~1500 tokens）。 */
const CHAPTER_CONTENT_MAX_CHARS = 5000

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

export function makeCurrentChapterProvider(
  accessor: SnapshotAccessor
): ContextProvider {
  return {
    id: 'current-chapter',
    priority: 95,
    isApplicable(surface: SurfaceDefinition) {
      return surfaceHasChapterScope(surface)
    },
    truncationHint:
      '当前章节正文因预算受限省略。请调用 read_chapter 主动读取。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const chapterId = parseChapterScopeRef(request.scopeRef)
      if (!chapterId) return null

      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view) return null

      const chapter = view.workspace.chapters.find((c) => c.id === chapterId)
      if (!chapter) return null

      const plain = stripHtml(chapter.content)
      const truncated = plain.length > CHAPTER_CONTENT_MAX_CHARS
      const body = [
        `- 标题：${chapter.title}`,
        chapter.summary ? `- 摘要：${chapter.summary}` : '',
        `- 状态：${chapter.status}`,
        chapter.wordTarget ? `- 字数目标：${chapter.wordTarget}` : '',
        '',
        '正文：',
        plain.slice(0, CHAPTER_CONTENT_MAX_CHARS),
        truncated ? '\n（正文较长已截断，需要完整文本请调用 read_chapter）' : ''
      ]
        .filter(Boolean)
        .join('\n')

      return makeSlice('current-chapter', 95, '当前章节', body)
    }
  }
}
