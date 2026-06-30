import { randomUUID } from 'node:crypto'
import type { Tool } from './types'
import {
  applyChapterEdit,
  computeChapterEdit,
  listProjectChapters,
  readChapterFromDb,
  searchProjectData
} from './chapter-data-access'

export type ChapterToolCallbacks = {
  currentChapterId: string
  useDiffReview?: boolean
  onEditApplied?: (chapterId: string, editType: string, preview: string, versionId: string) => void
  onEditProposed?: (chapterId: string, proposalId: string, editType: string, preview: string, oldContent: string, newContent: string) => void
}

export function createChapterTools(callbacks: ChapterToolCallbacks): Tool[] {
  const { currentChapterId, useDiffReview, onEditApplied, onEditProposed } = callbacks
  const virtualContent = new Map<string, string>()

  const readChapter: Tool = {
    definition: {
      name: 'read_chapter',
      description: 'Read a chapter in the current project. If chapter_id is omitted, read the currently active chapter.',
      inputSchema: {
        type: 'object',
        properties: {
          chapter_id: {
            type: 'string',
            description: 'Optional chapter ID. Omit to read the current chapter.'
          },
          include_content: {
            type: 'boolean',
            description: 'Whether to include full chapter content. Defaults to true.'
          }
        }
      }
    },
    handler: async (input, ctx) => {
      const chapterId = String(input.chapter_id || currentChapterId).trim()
      if (!chapterId) {
        return {
          content: 'No chapter_id was provided and there is no active chapter. Use list_chapters first or ask the user which chapter to inspect.',
          isError: true
        }
      }

      const chapter = await readChapterFromDb(ctx.projectId, chapterId)
      if (!chapter) {
        return { content: `Chapter not found: ${chapterId}`, isError: true }
      }

      const includeContent = input.include_content !== false
      const plainContent = includeContent
        ? chapter.content
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim()
        : null

      const lines = [
        `Title: ${chapter.title}`,
        `Status: ${chapter.status}`,
        `Word target: ${chapter.wordTarget}`,
        `Summary: ${chapter.summary || '(none)'}`
      ]

      if (plainContent) {
        const truncated = plainContent.length > 15000
          ? `${plainContent.slice(0, 15000)}\n...(truncated)`
          : plainContent
        lines.push(`\nContent:\n${truncated}`)
      }

      return { content: lines.join('\n') }
    }
  }

  const editChapter: Tool = {
    definition: {
      name: 'edit_chapter',
      description: 'Prepare or apply a chapter content edit. Supports replace, insert, and append. In diff review mode, this creates a pending review proposal and does not write to the chapter until the user approves it.',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['replace', 'insert', 'append'],
            description: 'Edit operation.'
          },
          chapter_id: {
            type: 'string',
            description: 'Optional target chapter ID. Omit to edit the active chapter.'
          },
          search: {
            type: 'string',
            description: 'Required for replace. Optional anchor text for insert.'
          },
          content: {
            type: 'string',
            description: 'New content to write.'
          },
          position: {
            type: 'string',
            enum: ['before', 'after', 'start', 'end'],
            description: 'Insert position.'
          }
        },
        required: ['operation', 'content']
      }
    },
    handler: async (input, ctx) => {
      const targetChapterId = String(input.chapter_id || currentChapterId).trim()
      if (!targetChapterId) {
        return { content: 'No chapter_id was provided and there is no active chapter, so edit_chapter cannot run. Use list_chapters or search_project first.', isError: true }
      }

      const operation = String(input.operation) as 'replace' | 'insert' | 'append'
      const content = String(input.content || '')
      const search = input.search ? String(input.search) : undefined
      const position = input.position ? String(input.position) as 'before' | 'after' | 'start' | 'end' : undefined

      if (!content.trim()) {
        return { content: 'content cannot be empty.', isError: true }
      }
      if (operation === 'replace' && !search) {
        return { content: 'replace requires search.', isError: true }
      }

      try {
        if (useDiffReview && onEditProposed) {
          const computed = await computeChapterEdit(ctx.projectId, targetChapterId, {
            operation,
            search,
            content,
            position
          }, virtualContent.get(targetChapterId))

          virtualContent.set(targetChapterId, computed.newContent)

          const proposalId = randomUUID()
          onEditProposed(targetChapterId, proposalId, operation, computed.preview, computed.oldContent, computed.newContent)
          return {
            content: `已生成待审查的章节修改提案：${computed.preview}。正文尚未写回；只有用户在 Diff 审阅中确认写回后才会生效。请不要把这描述为已修复或已写入。`
          }
        }

        const result = await applyChapterEdit(ctx.projectId, targetChapterId, {
          operation,
          search,
          content,
          position
        })
        onEditApplied?.(targetChapterId, operation, result.preview, result.versionId)
        return { content: `Edit applied: ${result.preview}. Snapshot version saved: ${result.versionId}` }
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true }
      }
    }
  }

  const searchProject: Tool = {
    definition: {
      name: 'search_project',
      description: 'Search project data and return hits with entity_type and entity_id so the agent can follow up with read_project_data.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query.'
          },
          scope: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'worldview',
                'characters',
                'organizations',
                'organization_memberships',
                'relationships',
                'outline',
                'available_deconstructions',
                'reference_works',
                'deconstruction_library',
                'knowledge',
                'chapters',
                'plot_threads',
                'inspiration',
                'workflow_documents',
                'project_constraints'
              ]
            },
            description: 'Optional scope filter.'
          },
          max_results: {
            type: 'integer',
            description: 'Maximum number of results. Defaults to 10.'
          }
        },
        required: ['query']
      }
    },
    handler: async (input, ctx) => {
      const query = String(input.query || '').trim()
      if (!query) {
        return { content: 'query cannot be empty.', isError: true }
      }

      const scope = Array.isArray(input.scope) ? input.scope.map(String) : undefined
      const maxResults = typeof input.max_results === 'number' ? input.max_results : 10

      const results = await searchProjectData(ctx.projectId, query, scope, maxResults)
      if (results.length === 0) {
        return { content: `No project data matched "${query}".` }
      }

      const formatted = results
        .map((result, index) => [
          `${index + 1}. [${result.type}] ${result.title}`,
          `entity_type: ${result.entityType}`,
          `entity_id: ${result.entityId}`,
          `snippet: ${result.content}`
        ].join('\n'))
        .join('\n\n---\n\n')

      return {
        content: `Found ${results.length} result(s).\n\n${formatted}`.slice(0, 12000)
      }
    }
  }

  const listChapters: Tool = {
    definition: {
      name: 'list_chapters',
      description: 'List all chapters in the current project.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    handler: async (_input, ctx) => {
      const chapters = await listProjectChapters(ctx.projectId)
      if (chapters.length === 0) {
        return { content: 'No chapters exist in the current project.' }
      }

      const lines = chapters.map((chapter, index) =>
        `${index + 1}. [${chapter.id}] ${chapter.title} (${chapter.status}, ${chapter.wordCount} chars)${chapter.summary ? ` - ${chapter.summary}` : ''}`
      )
      return { content: `Total chapters: ${chapters.length}\n${lines.join('\n')}` }
    }
  }

  return [readChapter, editChapter, searchProject, listChapters]
}
