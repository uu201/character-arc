import type { AiKnowledgeDocumentDraft } from '../../shared-types'
import type { Tool, ToolHandlerResult } from './types'

/** 合法的知识文档来源类型集合 */
const VALID_SOURCE_TYPES = new Set<AiKnowledgeDocumentDraft['sourceType']>([
  'reference-summary',
  'reference-chunk',
  'workflow-document',
  'canon-fact',
  'chapter-summary'
])

export type KnowledgeToolFactoryOptions = {
  /** 单次 agent loop 内的"已落库"集合。每次工具调用 push 进来。 */
  collectDocument: (doc: AiKnowledgeDocumentDraft) => void | string | Promise<void | string>
  /** 默认 sourceType——agent 没显式指定时使用。如 reference-deep-analyze 默认 reference-summary。 */
  defaultSourceType?: AiKnowledgeDocumentDraft['sourceType']
  /** 默认 sourceLabel——通常是参考作品的书名等。 */
  defaultSourceLabel?: string
  /** 单文档 content 上限（防 prompt 注入式刷屏）。默认 12000。 */
  maxContentChars?: number
  /** 单次 loop 最多落库文档数。默认 30，防工具被反复刷。 */
  maxDocuments?: number
}

/** 单文档内容默认上限字符数 */
const DEFAULT_MAX_CONTENT_CHARS = 12_000
/** 单次 loop 默认最多落库文档数 */
const DEFAULT_MAX_DOCUMENTS = 30

/** 构造成功的工具返回 */
function ok(content: string): ToolHandlerResult {
  return { content }
}

/** 构造失败的工具返回 */
function err(message: string): ToolHandlerResult {
  return { content: message, isError: true }
}

/**
 * 创建知识文档相关的工具
 * @param opts - 工厂配置选项
 * @returns 包含 knowledge_save_document 的工具数组
 */
export function createKnowledgeTools(opts: KnowledgeToolFactoryOptions): Tool[] {
  const maxContent = opts.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS
  const maxDocuments = opts.maxDocuments ?? DEFAULT_MAX_DOCUMENTS
  let savedCount = 0

  const knowledgeSaveDocument: Tool = {
    definition: {
      name: 'knowledge_save_document',
      description:
        '把一段结构化的知识保存进当前项目的"知识中心"。AI 在拆书 / 梳理设定 / 摘要章节时，应该用本工具把每个独立的知识点（一份总纲、一个角色画像、一段场景分析、一条章节摘要等）单独存为一份文档。后续写大纲 / 写章节时这些文档会被自动检索到。',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '文档标题。短且能识别，如《XXX》｜拆书总纲、《XXX》｜角色：李三 等。'
          },
          sourceType: {
            type: 'string',
            description:
              '文档类型：reference-summary（拆书总纲，整体风格 / 故事线 / 人物架构）、reference-chunk（拆书分块，单段或单章的具体桥段分析）、workflow-document（创作记忆）、canon-fact（项目设定事实）、chapter-summary（章节摘要）。',
            enum: Array.from(VALID_SOURCE_TYPES)
          },
          sourceLabel: {
            type: 'string',
            description: '可选。来源标签，如 story-deep-audit、writing-journal、assistant-v2。省略时使用当前任务默认来源。'
          },
          content: {
            type: 'string',
            description: '完整的文档正文（建议结构化 markdown，便于后续阅读）。'
          },
          summary: {
            type: 'string',
            description: '可选。一句话摘要（≤200 字），用于检索时快速扫描；省略则用 content 前 220 字。'
          },
          keywords: {
            type: 'array',
            description: '可选但强烈建议。3-8 个关键词，用于检索匹配。',
            items: { type: 'string' }
          },
          metadata: {
            type: 'object',
            description: '可选。附加结构化字段（如 styleRules / plotFunction / character_role 等），便于后续工具解析。',
            additionalProperties: true
          }
        },
        required: ['title', 'sourceType', 'content']
      }
    },
    async handler(input) {
      try {
        if (savedCount >= maxDocuments) {
          return err(`已达本次任务的落库上限 ${maxDocuments} 份。请整合后再保存或终止任务。`)
        }
        const title = String(input.title ?? '').trim()
        if (!title) return err('参数 title 不能为空')
        const content = String(input.content ?? '').trim()
        if (!content) return err('参数 content 不能为空')

        const rawSourceType = String(input.sourceType ?? opts.defaultSourceType ?? '').trim()
        const sourceType = VALID_SOURCE_TYPES.has(rawSourceType as AiKnowledgeDocumentDraft['sourceType'])
          ? (rawSourceType as AiKnowledgeDocumentDraft['sourceType'])
          : null
        if (!sourceType) {
          return err(`参数 sourceType 非法：${rawSourceType}。可选：${Array.from(VALID_SOURCE_TYPES).join(', ')}`)
        }

        const summaryRaw = typeof input.summary === 'string' ? input.summary.trim() : ''
        const summary = summaryRaw || content.slice(0, 220)

        const keywords = Array.isArray(input.keywords)
          ? input.keywords
              .map((k) => String(k).trim())
              .filter(Boolean)
              .slice(0, 12)
          : undefined

        const metadataInput = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
          ? (input.metadata as Record<string, unknown>)
          : {}
        // 强制把 sourceTitle 写进 metadata（如果 defaultSourceLabel 提供了），让 mergeKnowledgeDocuments
        // 的 sourceTitle::fileName 去重逻辑生效——同一个参考作品再次拆书时旧文档被替换。
        const metadata: Record<string, unknown> = opts.defaultSourceLabel
          ? { sourceTitle: opts.defaultSourceLabel, ...metadataInput }
          : metadataInput

        const truncatedContent = content.length > maxContent ? content.slice(0, maxContent) : content
        const truncated = truncatedContent.length < content.length

        const sourceLabel = typeof input.sourceLabel === 'string' && input.sourceLabel.trim()
          ? input.sourceLabel.trim()
          : opts.defaultSourceLabel ?? ''

        const draft: AiKnowledgeDocumentDraft = {
          title,
          sourceType,
          sourceLabel,
          content: truncatedContent,
          summary,
          ...(keywords ? { keywords } : {}),
          ...(Object.keys(metadata).length > 0 ? { metadata } : {})
        }

        const savedId = await opts.collectDocument(draft)
        savedCount += 1

        return ok([
          `已落库第 ${savedCount} 份知识文档：${title}（${sourceType}，${truncatedContent.length} 字${truncated ? '，超长已截断' : ''}${savedId ? `，ID: ${savedId}` : ''}）。`,
          '继续保存其余维度的知识，或如果已经覆盖完所有需要拆解的内容，直接给出最终回复结束本次任务。'
        ].join('\n'))
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return [knowledgeSaveDocument]
}
