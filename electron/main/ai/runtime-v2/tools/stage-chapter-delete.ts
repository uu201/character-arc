/**
 * stage_chapter_delete · 删除章节暂存工具（Runtime v2）
 *
 * 只生成 kind='chapter'、action='delete' 的暂存变更。用户确认后由
 * committer 真正删除章节；项目始终至少保留一个章节。
 */

import type { Tool } from '../../agent/tools/types'
import {
  listProjectChapters,
  readChapterFromDb,
  resolveProjectChapterId
} from '../../agent/tools/chapter-data-access'
import type { StagedChangesStore } from '../staged-changes-store'

export interface StageChapterDeleteToolDeps {
  sessionId: string
  turnId: string
  projectId: string
  stagedStore: StagedChangesStore
  currentChapterId?: string
}

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

export function makeStageChapterDeleteTool(deps: StageChapterDeleteToolDeps): Tool {
  return {
    definition: {
      name: 'stage_chapter_delete',
      description:
        '暂存删除已有章节，不直接写库。chapter_id 可传真实 ID、章节标题、序号或“第一章/第1章”等自然引用；省略时删除当前激活章节。删除属破坏性操作，必须有明确用户要求，并在 reason 中说明依据。项目至少保留一个章节。用户在暂存区确认后才真正删除。',
      inputSchema: {
        type: 'object',
        properties: {
          chapter_id: {
            type: 'string',
            description: '目标章节 ID、标题、序号或自然引用。省略时使用当前激活章节。'
          },
          reason: { type: 'string', description: '简短说明为什么删除该章节。' }
        },
        required: ['reason']
      }
    },
    handler: async (input) => {
      const rawChapterRef = String(input.chapter_id || deps.currentChapterId || '').trim()
      if (!rawChapterRef) {
        return {
          content: '没有提供章节引用，也没有当前激活章节。请先用 list_chapters 定位目标章节。',
          isError: true
        }
      }

      const chapters = await listProjectChapters(deps.projectId)
      if (chapters.length <= 1) {
        return { content: '项目至少需要保留一个章节，无法删除最后一章。', isError: true }
      }

      let chapterId = ''
      try {
        chapterId = await resolveProjectChapterId(deps.projectId, rawChapterRef)
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true }
      }

      const duplicate = deps.stagedStore
        .list({}, deps.sessionId)
        .find((change) => change.kind === 'chapter' && change.action === 'delete' && change.entityId === chapterId && change.status !== 'rejected')
      if (duplicate) {
        return { content: `章节删除已在暂存区中（change_id=${duplicate.id}），无需重复暂存。`, isError: true }
      }

      const chapter = await readChapterFromDb(deps.projectId, chapterId)
      if (!chapter) return { content: `章节不存在或已删除：${chapterId}`, isError: true }

      const reason = typeof input.reason === 'string' && input.reason.trim()
        ? input.reason.trim()
        : '（未提供理由）'
      const plainContent = stripHtml(chapter.content)
      const before = [
        `标题：${chapter.title}`,
        chapter.summary ? `摘要：${chapter.summary}` : '',
        `状态：${chapter.status}`,
        chapter.wordTarget ? `字数目标：${chapter.wordTarget}` : '',
        plainContent ? `正文：\n${plainContent}` : '正文：（空）'
      ].filter(Boolean).join('\n')

      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'chapter',
        action: 'delete',
        entityId: chapter.id,
        entityTitle: chapter.title,
        reason,
        before,
        after: '',
        entityPayload: { title: chapter.title }
      })

      return {
        content: `已暂存章节删除（change_id=${change.id}）：${chapter.title}。章节尚未删除；用户在暂存区确认后才会生效。请不要描述为“已删除”。`
      }
    }
  }
}
