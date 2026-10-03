import { randomUUID } from 'node:crypto'
import type { Tool } from '../../agent/tools/types'
import type { ChapterEdit } from '../../agent/tools/chapter-data-access'
import type { StagedChangesStore } from '../staged-changes-store'

const REVISION_COLORS = ['#FFE58F', '#BAE7FF', '#B7EB8F', '#D3ADF7', '#FFD591', '#87E8DE'] as const

function revisionColorForTurn(turnId: string): string {
  let hash = 0
  for (let i = 0; i < turnId.length; i += 1) {
    hash = ((hash << 5) - hash + turnId.charCodeAt(i)) | 0
  }
  return REVISION_COLORS[Math.abs(hash) % REVISION_COLORS.length]
}

export interface StageChapterSummaryItem {
  id: string
  title: string
  summary: string
  status: string
  wordCount: number
}

export interface StageChapterEditResult {
  oldContent: string
  newContent: string
  preview: string
  chapterTitle: string
  beforeFragment: string
  afterFragment: string
}

export interface StageChapterEditDataAccess {
  readChapterFromDb: (projectId: string, chapterId: string) => Promise<{ id: string } | null>
  listProjectChapters: (projectId: string) => Promise<StageChapterSummaryItem[]>
  computeChapterEdit: (
    projectId: string,
    chapterId: string,
    edit: ChapterEdit,
    overrideContent?: string
  ) => Promise<StageChapterEditResult>
}

export interface StageChapterEditToolDeps {
  sessionId: string
  turnId: string
  projectId: string
  stagedStore: StagedChangesStore
  dataAccess: StageChapterEditDataAccess
  /** Surface 的"当前激活章节"；用户没传 chapter_id 时兜底。 */
  currentChapterId?: string
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}

function normalizeChapterRef(ref: string): string {
  return ref.replace(/\s+/g, '').replace(/[·・]/g, '').toLowerCase()
}

function parseChapterOrdinal(ref: string): number | null {
  const digits = ref.match(/^第?\s*(\d+)\s*章?$/)
  if (digits) return Number.parseInt(digits[1], 10)
  const chinese = ref.match(/^第?\s*([零一二两三四五六七八九十]+)\s*章?$/)
  if (!chinese) return null
  const value = chinese[1]
  if (value === '十') return 10
  const tenIndex = value.indexOf('十')
  if (tenIndex >= 0) {
    const before = value.slice(0, tenIndex)
    const after = value.slice(tenIndex + 1)
    const tens = before ? CHINESE_DIGITS[before] ?? 0 : 1
    const ones = after ? CHINESE_DIGITS[after] ?? 0 : 0
    return tens * 10 + ones
  }
  return CHINESE_DIGITS[value] ?? null
}

async function resolveChapterId(
  projectId: string,
  ref: string,
  dataAccess: StageChapterEditDataAccess
): Promise<string> {
  const rawRef = ref.trim()
  if (!rawRef) return ''

  const direct = await dataAccess.readChapterFromDb(projectId, rawRef)
  if (direct) return direct.id

  const chapters = await dataAccess.listProjectChapters(projectId)
  const normalizedRef = normalizeChapterRef(rawRef)
  const ordinal = parseChapterOrdinal(rawRef)
  if (ordinal !== null && ordinal >= 1 && ordinal <= chapters.length) {
    return chapters[ordinal - 1].id
  }

  const exactTitle = chapters.find((c) => normalizeChapterRef(c.title) === normalizedRef)
  if (exactTitle) return exactTitle.id

  const contains = chapters.filter((c) => normalizeChapterRef(c.title).includes(normalizedRef))
  if (contains.length === 1) return contains[0].id

  throw new Error(formatResolveError(rawRef, chapters))
}

function formatResolveError(ref: string, chapters: StageChapterSummaryItem[]): string {
  if (!chapters.length) return '当前项目还没有章节。'
  const options = chapters.slice(0, 20).map((c, i) => `${i + 1}. ${c.title}`).join('\n')
  return `无法定位章节"${ref}"。可选章节：\n${options}`
}

function isRecoverableLocateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /^(Could not find|Ambiguous) (target|anchor) text:/.test(message)
}

export function makeStageChapterEditToolCore(deps: StageChapterEditToolDeps): Tool {
  /** 章节 virtual buffer：同一 turn 内多次 stage 时累积 diff（相邻编辑基于前次结果）。 */
  const buffer = new Map<string, string>()

  return {
    definition: {
      name: 'stage_chapter_edit',
      description:
        '暂存对章节正文的修改，不直接写库。变更进入待审阅暂存区，用户在 UI 中确认后才写回。局部替换用 replace 并提供 search；整章重写必须显式用 replace_all，无需 search；另支持 insert/append。',
      inputSchema: {
        type: 'object',
        properties: {
          chapter_id: {
            type: 'string',
            description: '章节 ID、标题或序号（如 "第三章" / "3" / 精确标题）。缺省用当前激活章节。'
          },
          operation: {
            type: 'string',
            enum: ['replace', 'replace_all', 'insert', 'append'],
            description: 'replace=按 search 定位后局部替换；replace_all=整章替换且无需 search；insert=按 search 或 position 插入；append=末尾追加。'
          },
          content: { type: 'string', description: '要写入的新文本（纯文本，工具会转成段落）。' },
          search: { type: 'string', description: 'replace 必填：目标文本；insert 可选：锚点文本。' },
          position: {
            type: 'string',
            enum: ['before', 'after', 'start', 'end'],
            description: 'insert 用；before/after 相对 search；start/end 相对全文。'
          },
          reason: { type: 'string', description: '简短的修改理由（会显示在暂存卡片上）。' }
        },
        required: ['operation', 'content', 'reason']
      }
    },
    handler: async (input) => {
      const rawRef = String(input.chapter_id || deps.currentChapterId || '').trim()
      if (!rawRef) {
        return {
          content: '未提供 chapter_id，也没有当前章节。请先用 list_chapters 定位目标。',
          isError: true
        }
      }

      let chapterId = ''
      try {
        chapterId = await resolveChapterId(deps.projectId, rawRef, deps.dataAccess)
      } catch (e) {
        return { content: e instanceof Error ? e.message : String(e), isError: true }
      }

      // 章节面板只允许修改当前章节，禁止跨章节编辑
      if (deps.currentChapterId && chapterId !== deps.currentChapterId) {
        return {
          content: `章节助理只能修改当前章节。如需编辑其他章节请切换到对应章节后再操作。`,
          isError: true
        }
      }

      const operation = String(input.operation) as 'replace' | 'replace_all' | 'insert' | 'append'
      const content = String(input.content || '')
      const search = input.search ? String(input.search) : undefined
      const position = input.position
        ? (String(input.position) as 'before' | 'after' | 'start' | 'end')
        : undefined
      const reason = String(input.reason || '').trim() || '（未提供理由）'

      if (!content.trim()) return { content: 'content cannot be empty.', isError: true }
      if (operation === 'replace' && !search) {
        return { content: 'replace 需要提供 search。', isError: true }
      }

      try {
        const changeId = randomUUID()
        const computed = await deps.dataAccess.computeChapterEdit(
          deps.projectId,
          chapterId,
          {
            operation,
            search,
            content,
            position,
            revision: {
              id: changeId,
              source: 'ai',
              color: revisionColorForTurn(deps.turnId),
              turnId: deps.turnId,
              reason,
              createdAt: new Date().toISOString()
            }
          },
          buffer.get(chapterId)
        )
        buffer.set(chapterId, computed.newContent)

        const change = deps.stagedStore.add({
          id: changeId,
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'chapter',
          action: 'update',
          entityId: chapterId,
          entityTitle: computed.chapterTitle,
          reason,
          // 只存变更片段（前/后），不存整章，避免 diff 展示整篇文章
          before: computed.beforeFragment,
          after: computed.afterFragment,
          chapterHtml: { old: computed.oldContent, new: computed.newContent }
        })

        return {
          content: [
            `已暂存章节修改（change_id=${change.id}）：${computed.preview}。`,
            `正文尚未写回；用户在暂存区确认后才会生效。请不要将此描述为"已修复"或"已写入"。`
          ].join('\n')
        }
      } catch (e) {
        if (isRecoverableLocateError(e)) {
          const detail = e instanceof Error ? e.message : String(e)
          const suggestion = detail.startsWith('Ambiguous')
            ? '目标原文在章节中出现多次。请重新读取章节，并提供包含前后文、能够唯一定位的更长 search 片段。'
            : '请先重新读取目标章节，然后用更短、连续、逐字来自正文的 search 片段重试；如果只是加内容，改用 append 或 insert 的 start/end。'
          return {
            content: [
              `未能定位要修改的原文片段，本次没有暂存章节修改：${detail}`,
              suggestion
            ].join('\n')
          }
        }
        return { content: e instanceof Error ? e.message : String(e), isError: true }
      }
    }
  }
}
