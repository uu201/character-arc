import type { Tool, ToolContext } from './types'
import {
  applyChapterEdit,
  listProjectChapters,
  readChapterFromDb,
  searchProjectData
} from './chapter-data-access'

export type ChapterToolCallbacks = {
  currentChapterId: string
  onEditApplied?: (chapterId: string, editType: string, preview: string, versionId: string) => void
}

export function createChapterTools(callbacks: ChapterToolCallbacks): Tool[] {
  const { currentChapterId, onEditApplied } = callbacks

  const readChapter: Tool = {
    definition: {
      name: 'read_chapter',
      description: '读取当前项目中某个章节的内容和元数据。不传 chapter_id 时读取当前正在编辑的章节。',
      inputSchema: {
        type: 'object',
        properties: {
          chapter_id: { type: 'string', description: '章节 ID。省略则读取当前章节。' },
          include_content: { type: 'boolean', description: '是否包含正文内容（默认 true）。设为 false 只返回标题/摘要/状态等元数据。' }
        }
      }
    },
    handler: async (input, ctx) => {
      const chapterId = String(input.chapter_id || currentChapterId).trim()
      if (!chapterId) return { content: '错误：未指定章节 ID，且当前没有正在编辑的章节。', isError: true }

      const chapter = await readChapterFromDb(ctx.projectId, chapterId)
      if (!chapter) return { content: `错误：未找到章节 ${chapterId}`, isError: true }

      const includeContent = input.include_content !== false
      const plainContent = includeContent
        ? chapter.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
        : null

      const lines = [
        `标题: ${chapter.title}`,
        `状态: ${chapter.status}`,
        `目标字数: ${chapter.wordTarget}`,
        `摘要: ${chapter.summary || '(无)'}`,
      ]
      if (plainContent) {
        const truncated = plainContent.length > 15000 ? plainContent.slice(0, 15000) + '\n...(内容过长已截断)' : plainContent
        lines.push(`\n正文内容:\n${truncated}`)
      }
      return { content: lines.join('\n') }
    }
  }

  const editChapter: Tool = {
    definition: {
      name: 'edit_chapter',
      description: '编辑当前章节的正文内容。支持三种操作：replace（替换匹配的文本段）、insert（在指定位置插入）、append（追加到末尾）。编辑会立即生效，系统会自动创建版本快照供撤销。',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['replace', 'insert', 'append'], description: '编辑操作类型' },
          search: { type: 'string', description: 'replace 操作时必填：要被替换的原文片段（精确匹配）' },
          content: { type: 'string', description: '新内容。replace 时为替换后的文本；insert/append 时为要插入的文本。' },
          position: { type: 'string', enum: ['before', 'after', 'start', 'end'], description: 'insert 操作时的插入位置（相对于 search 文本）' }
        },
        required: ['operation', 'content']
      }
    },
    handler: async (input, ctx) => {
      const operation = String(input.operation) as 'replace' | 'insert' | 'append'
      const content = String(input.content || '')
      const search = input.search ? String(input.search) : undefined
      const position = input.position ? String(input.position) as 'before' | 'after' | 'start' | 'end' : undefined

      if (!content.trim()) return { content: '错误：content 不能为空', isError: true }
      if (operation === 'replace' && !search) return { content: '错误：replace 操作需要 search 参数', isError: true }

      try {
        const result = await applyChapterEdit(ctx.projectId, currentChapterId, {
          operation,
          search,
          content,
          position
        })
        onEditApplied?.(currentChapterId, operation, result.preview, result.versionId)
        return { content: `编辑成功：${result.preview}（版本快照已保存，可撤销）` }
      } catch (error) {
        return { content: `编辑失败：${error instanceof Error ? error.message : String(error)}`, isError: true }
      }
    }
  }

  const searchProject: Tool = {
    definition: {
      name: 'search_project',
      description: '在当前项目的世界观、角色、大纲、知识文档、章节摘要、剧情线索中搜索信息。返回匹配的条目摘要。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或短语' },
          scope: {
            type: 'array',
            items: { type: 'string', enum: ['worldview', 'characters', 'outline', 'knowledge', 'chapters', 'plot_threads'] },
            description: '搜索范围。省略则搜索全部。'
          },
          max_results: { type: 'integer', description: '最多返回条目数（默认 10）' }
        },
        required: ['query']
      }
    },
    handler: async (input, ctx) => {
      const query = String(input.query || '').trim()
      if (!query) return { content: '错误：query 不能为空', isError: true }

      const scope = Array.isArray(input.scope) ? input.scope.map(String) : undefined
      const maxResults = typeof input.max_results === 'number' ? input.max_results : 10

      const results = await searchProjectData(ctx.projectId, query, scope, maxResults)
      if (results.length === 0) return { content: `未找到与"${query}"相关的内容。` }

      const formatted = results.map((r) => `[${r.type}] ${r.title}\n${r.content}`).join('\n\n---\n\n')
      const output = `找到 ${results.length} 条结果：\n\n${formatted}`
      return { content: output.slice(0, 8000) }
    }
  }

  const listChapters: Tool = {
    definition: {
      name: 'list_chapters',
      description: '获取当前项目的所有章节列表，包含标题、摘要、状态和字数。',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    handler: async (_input, ctx) => {
      const chapters = await listProjectChapters(ctx.projectId)
      if (chapters.length === 0) return { content: '当前项目没有章节。' }

      const lines = chapters.map((c, i) =>
        `${i + 1}. [${c.id}] ${c.title} (${c.status}, ${c.wordCount}字)${c.summary ? ` — ${c.summary}` : ''}`
      )
      return { content: `共 ${chapters.length} 章：\n${lines.join('\n')}` }
    }
  }

  return [readChapter, editChapter, searchProject, listChapters]
}
