import { randomUUID } from 'node:crypto'
import type { Tool } from './types'
import {
  applyChapterEdit,
  computeChapterEdit,
  type ChapterSummaryItem,
  listProjectChapters,
  readChapterFromDb,
  searchProjectData
} from './chapter-data-access'

export type ChapterToolCallbacks = {
  currentChapterId: string
  useDiffReview?: boolean
  originalUserPrompt?: string
  blockVagueChapterEdit?: boolean
  onEditApplied?: (chapterId: string, editType: string, preview: string, versionId: string) => void
  onEditProposed?: (chapterId: string, proposalId: string, editType: string, preview: string, oldContent: string, newContent: string) => void
}

export function createChapterTools(callbacks: ChapterToolCallbacks): Tool[] {
  const { currentChapterId, useDiffReview, originalUserPrompt = '', blockVagueChapterEdit, onEditApplied, onEditProposed } = callbacks
  const virtualContent = new Map<string, string>()

  function includesAnyText(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword))
  }

  function hasConcreteChapterEditDirection(prompt: string): boolean {
    const normalized = prompt.replace(/\s+/g, '')
    return includesAnyText(normalized, [
      '润色',
      '改写',
      '重写',
      '扩写',
      '续写',
      '精简',
      '压缩',
      '删除',
      '删掉',
      '删减',
      '拆长句',
      '拆句',
      '断句',
      '分段',
      '段落控',
      '段落控制',
      '调整段落',
      '调整节奏',
      '节奏',
      '开头',
      '开篇',
      '结尾',
      '对白',
      '对话',
      '描写',
      '心理',
      '动作',
      '氛围',
      '冲突',
      '悬念',
      '爽点',
      '疲软',
      '拖沓',
      '水分',
      '冗余',
      '机械',
      '模板感',
      '降低AI感',
      '降低ai感',
      '去AI味',
      '去ai味',
      '按建议改',
      '按你说的改',
      '应用修改',
      '写回正文'
    ])
  }

  function hasVagueChapterEditIntent(prompt: string): boolean {
    const normalized = prompt.replace(/\s+/g, '')
    const mentionsChapterTarget = (
      /第[零一二两三四五六七八九十百\d]+章/.test(normalized)
      || includesAnyText(normalized, ['当前章节', '章节正文', '章节内容', '小说正文', '正文内容'])
    )
    const asksToEdit = includesAnyText(normalized, ['修改', '改一下', '调整', '优化', '处理'])
    return mentionsChapterTarget && asksToEdit && !hasConcreteChapterEditDirection(normalized)
  }

  function normalizeChapterRef(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[《》「」『』“”"']/g, '')
  }

  function parseChapterOrdinal(ref: string): number | null {
    const normalized = normalizeChapterRef(ref)
    const arabic = normalized.match(/^第?(\d+)章?$/)
    if (arabic) {
      return Number(arabic[1])
    }

    const chineseDigits: Record<string, number> = {
      零: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9
    }
    const chinese = normalized.match(/^第?([零一二两三四五六七八九十百]+)章?$/)
    if (!chinese) return null

    const value = chinese[1]
    if (value === '十') return 10
    const tenIndex = value.indexOf('十')
    if (tenIndex >= 0) {
      const before = value.slice(0, tenIndex)
      const after = value.slice(tenIndex + 1)
      const tens = before ? chineseDigits[before] ?? 0 : 1
      const ones = after ? chineseDigits[after] ?? 0 : 0
      return tens * 10 + ones
    }
    return chineseDigits[value] ?? null
  }

  async function resolveChapterId(projectId: string, ref: string): Promise<string> {
    const rawRef = ref.trim()
    if (!rawRef) return ''

    const direct = await readChapterFromDb(projectId, rawRef)
    if (direct) return direct.id

    const chapters = await listProjectChapters(projectId)
    const normalizedRef = normalizeChapterRef(rawRef)
    const ordinal = parseChapterOrdinal(rawRef)
    if (ordinal !== null && ordinal >= 1 && ordinal <= chapters.length) {
      return chapters[ordinal - 1].id
    }

    const exactTitle = chapters.find((chapter) => normalizeChapterRef(chapter.title) === normalizedRef)
    if (exactTitle) return exactTitle.id

    const titleContains = chapters.filter((chapter) => normalizeChapterRef(chapter.title).includes(normalizedRef))
    if (titleContains.length === 1) {
      return titleContains[0].id
    }

    throw new Error(formatChapterResolveError(rawRef, chapters))
  }

  function formatChapterResolveError(ref: string, chapters: ChapterSummaryItem[]): string {
    if (!chapters.length) return '当前项目还没有章节。'
    const options = chapters
      .slice(0, 20)
      .map((chapter, index) => `${index + 1}. ${chapter.title}`)
      .join('\n')
    return `无法定位章节“${ref}”。请根据章节列表自行选择最可能的目标，必要时再询问用户：\n${options}`
  }

  const readChapter: Tool = {
    definition: {
      name: 'read_chapter',
      description: 'Read a chapter in the current project. If chapter_id is omitted, read the currently active chapter. chapter_id may be an actual ID, a title, or a natural reference like "第一章", "第1章", or "1".',
      inputSchema: {
        type: 'object',
        properties: {
          chapter_id: {
            type: 'string',
            description: 'Optional chapter ID, title, ordinal, or natural chapter reference. Examples: "第一章", "第1章", "1", "序章". Omit to read the current chapter.'
          },
          include_content: {
            type: 'boolean',
            description: 'Whether to include full chapter content. Defaults to true.'
          }
        }
      }
    },
    handler: async (input, ctx) => {
      const rawChapterRef = String(input.chapter_id || currentChapterId).trim()
      if (!rawChapterRef) {
        return {
          content: '没有提供章节引用，也没有当前激活章节。请先用 list_chapters 查看项目章节，并自行判断用户说的是哪一章。',
          isError: true
        }
      }

      let chapterId = ''
      try {
        chapterId = await resolveChapterId(ctx.projectId, rawChapterRef)
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true }
      }

      const chapter = await readChapterFromDb(ctx.projectId, chapterId)
      if (!chapter) return { content: `Chapter not found: ${chapterId}`, isError: true }

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
            description: 'Optional target chapter ID, title, ordinal, or natural chapter reference. Examples: "第一章", "第1章", "1", "序章". Omit to edit the active chapter.'
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
      if (blockVagueChapterEdit && hasVagueChapterEditIntent(originalUserPrompt)) {
        return {
          content: '用户当前只表达了想修改某一章，但没有说明修改目标、风格或问题点。不要生成章节写回提案；请先读取目标章节，给出简短诊断和可选修改方向，或追问用户想怎么改。'
        }
      }

      const rawChapterRef = String(input.chapter_id || currentChapterId).trim()
      if (!rawChapterRef) {
        return { content: '没有提供章节引用，也没有当前激活章节，所以无法修改正文。请先用 list_chapters 查看项目章节，并自行判断目标章节。', isError: true }
      }

      let targetChapterId = ''
      try {
        targetChapterId = await resolveChapterId(ctx.projectId, rawChapterRef)
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true }
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
