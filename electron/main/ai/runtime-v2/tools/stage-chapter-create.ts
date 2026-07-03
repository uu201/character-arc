/**
 * stage_chapter_create · 新建章节暂存工具（Runtime v2）
 *
 * 与 stage_chapter_edit 互补：edit 改已有章节，create 新建章节（可带初稿正文）。
 * 不直接写库，产出 kind='chapter'、action='create' 的暂存变更，用户确认后由
 * committer 执行 INSERT。初稿正文以 chapterHtml.new 承载（old=''）。
 */

import type { Tool } from '../../agent/tools/types'
import { textToHtmlParagraphs } from '../../agent/tools/chapter-data-access'
import type { StagedChangesStore } from '../staged-changes-store'
import type { SnapshotAccessor } from '../providers/shared'
import { getProjectView } from '../providers/shared'

export interface StageChapterCreateToolDeps {
  sessionId: string
  turnId: string
  projectId: string
  stagedStore: StagedChangesStore
  snapshot: SnapshotAccessor
  /** 当前激活章节；用于推断默认写入的分卷。 */
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

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function makeStageChapterCreateTool(deps: StageChapterCreateToolDeps): Tool {
  return {
    definition: {
      name: 'stage_chapter_create',
      description:
        '暂存新建章节，不直接写库。用于"新增一章""按大纲铺开新章节""生成新章节初稿"等场景。title 必填；可选 summary（章节摘要）、volume_id（所属分卷，缺省用当前分卷或第一个分卷）、outline_item_id（绑定的大纲节点 ID）、word_target、content（章节初稿正文纯文本，工具会转成段落）。用户在暂存区确认后才真正创建。',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '章节标题。必填。' },
          summary: { type: 'string', description: '章节摘要/概要。可选。' },
          volume_id: { type: 'string', description: '所属分卷 ID。缺省用当前章节所在分卷或项目第一个分卷。' },
          outline_item_id: { type: 'string', description: '要绑定的大纲节点 ID。按大纲生成章节时必须填写 read_project_data/search_project 返回的 outline entity_id。' },
          word_target: { type: 'string', description: '字数目标，如 "3000字"。可选。' },
          content: { type: 'string', description: '章节初稿正文（纯文本，段落之间用空行分隔）。可选；不填则创建空章节。' },
          reason: { type: 'string', description: '简短说明为什么新建这一章。' }
        },
        required: ['title', 'reason']
      }
    },
    handler: async (input) => {
      const view = getProjectView(deps.snapshot.getSnapshot(), deps.projectId)
      if (!view) return { content: '当前项目快照未就绪，无法暂存新建章节。', isError: true }

      const title = readString(input, 'title')
      if (!title) return { content: 'title 不能为空。', isError: true }

      const reason = readString(input, 'reason') || '（未提供理由）'
      const contentText = readString(input, 'content')

      // 分卷解析：显式 volume_id → 当前章节所在分卷 → 第一个分卷。
      const currentChapter = deps.currentChapterId
        ? view.workspace.chapters.find((chapter) => chapter.id === deps.currentChapterId)
        : null
      const requestedVolumeId = readString(input, 'volume_id')
      const volumeId = requestedVolumeId || currentChapter?.volumeId || view.workspace.outlineVolumes[0]?.id || ''
      const volume = view.workspace.outlineVolumes.find((item) => item.id === volumeId)
      const requestedOutlineItemId = readString(input, 'outline_item_id') || readString(input, 'outlineItemId')
      const requestedOutlineItem = requestedOutlineItemId
        ? view.workspace.outlineItems.find((item) => item.id === requestedOutlineItemId)
        : undefined
      if (requestedOutlineItemId && !requestedOutlineItem) {
        return { content: `大纲节点不存在，无法绑定：${requestedOutlineItemId}`, isError: true }
      }
      const matchedOutlineItem = requestedOutlineItem ?? view.workspace.outlineItems.find((item) =>
        item.volumeId === volumeId && item.title.trim() === title.trim()
      )
      const outlineItemId = matchedOutlineItem?.id ?? ''
      const summary = readString(input, 'summary') || matchedOutlineItem?.summary || ''
      const wordTarget = readString(input, 'word_target') || matchedOutlineItem?.wordTarget || ''

      const contentHtml = contentText ? textToHtmlParagraphs(contentText) : ''
      const payload = {
        title,
        summary,
        volumeId,
        outlineItemId,
        wordTarget
      }

      const afterLines = [
        `标题：${title}`,
        summary ? `摘要：${summary}` : '',
        volume ? `所属分卷：${volume.title}` : '',
        matchedOutlineItem ? `绑定大纲：${matchedOutlineItem.title}` : '',
        wordTarget ? `字数目标：${wordTarget}` : '',
        contentText ? `初稿正文：\n${contentText}` : '（空章节，无初稿正文）'
      ].filter(Boolean).join('\n')

      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'chapter',
        action: 'create',
        entityTitle: title,
        reason,
        before: '',
        after: afterLines,
        chapterHtml: { old: '', new: contentHtml },
        entityPayload: payload
      })

      return {
        content: [
          `已暂存新建章节（change_id=${change.id}）：${title}${volume ? `（分卷：${volume.title}）` : ''}${matchedOutlineItem ? `，绑定大纲：${matchedOutlineItem.title}` : ''}。`,
          contentText ? `含初稿正文约 ${stripHtml(contentHtml).length} 字。` : '为空章节。',
          '章节尚未创建；用户在暂存区确认后才会写入。请不要描述为"已创建"。'
        ].filter(Boolean).join('\n')
      }
    }
  }
}
