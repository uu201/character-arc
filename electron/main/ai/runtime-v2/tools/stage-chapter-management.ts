/** Runtime v2 章节元数据与版本管理工具。 */

import type { Tool } from '../../agent/tools/types'
import { resolveProjectChapterId } from '../../agent/tools/chapter-data-access'
import { ensureWorkspaceDb } from '../../../workspace-store'
import type { StagedChangesStore } from '../staged-changes-store'

export interface StageChapterManagementToolDeps {
  sessionId: string
  turnId: string
  projectId: string
  stagedStore: StagedChangesStore
  currentChapterId?: string
}

type ChapterRow = {
  id: string
  volume_id: string
  outline_item_id: string
  title: string
  summary: string
  status: string
  word_target: string
  content: string
}

type ChapterVersionRow = {
  id: string
  chapter_id: string
  title: string
  summary: string
  status: string
  word_target: string
  content: string
  created_at: string
}

const CHAPTER_STATUSES = new Set(['draft', 'review', 'polish', 'final'])

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
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

function renderChapterMetadata(chapter: {
  title: string
  summary: string
  status: string
  wordTarget: string
  volumeTitle: string
  outlineTitle: string
}): string {
  return [
    `标题：${chapter.title}`,
    `摘要：${chapter.summary || '（空）'}`,
    `状态：${chapter.status}`,
    `字数目标：${chapter.wordTarget}`,
    `所属分卷：${chapter.volumeTitle || '（未绑定）'}`,
    `绑定大纲：${chapter.outlineTitle || '（未绑定）'}`
  ].join('\n')
}

async function readChapter(projectId: string, chapterId: string): Promise<ChapterRow | undefined> {
  const db = await ensureWorkspaceDb()
  return db.prepare(`
    SELECT id, volume_id, outline_item_id, title, summary, status, word_target, content
    FROM chapters
    WHERE id = ? AND project_id = ?
  `).get(chapterId, projectId) as ChapterRow | undefined
}

async function resolveChapterRef(
  deps: StageChapterManagementToolDeps,
  input: Record<string, unknown>
): Promise<string> {
  const rawRef = String(input.chapter_id || deps.currentChapterId || '').trim()
  if (!rawRef) throw new Error('未提供 chapter_id，也没有当前激活章节。请先用 list_chapters 定位目标。')
  return resolveProjectChapterId(deps.projectId, rawRef)
}

export function makeStageChapterUpdateTool(deps: StageChapterManagementToolDeps): Tool {
  return {
    definition: {
      name: 'stage_chapter_update',
      description:
        '暂存修改章节元数据，不修改正文。可修改 title、summary、status、word_target、volume_id、outline_item_id；outline_item_id 传空字符串可解除大纲绑定。chapter_id 支持 ID、标题、序号和“第一章”等自然引用。用户确认后才写回。',
      inputSchema: {
        type: 'object',
        properties: {
          chapter_id: { type: 'string', description: '目标章节 ID、标题或自然引用；省略时使用当前章节。' },
          title: { type: 'string', description: '新章节标题。' },
          summary: { type: 'string', description: '新章节摘要，可传空字符串清空。' },
          status: { type: 'string', enum: ['draft', 'review', 'polish', 'final'], description: '章节状态。' },
          word_target: { type: 'string', description: '字数目标，如“预估 3000字”。' },
          volume_id: { type: 'string', description: '目标分卷 ID，可由 list_outline_volumes 获取。' },
          outline_item_id: { type: 'string', description: '绑定的大纲节点 ID；传空字符串解除绑定。' },
          reason: { type: 'string', description: '简短说明修改原因。' }
        },
        required: ['reason']
      }
    },
    handler: async (input) => {
      let chapterId = ''
      try {
        chapterId = await resolveChapterRef(deps, input)
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true }
      }

      const chapter = await readChapter(deps.projectId, chapterId)
      if (!chapter) return { content: `章节不存在：${chapterId}`, isError: true }

      const changedKeys = ['title', 'summary', 'status', 'word_target', 'volume_id', 'outline_item_id']
        .filter((key) => hasOwn(input, key))
      if (!changedKeys.length) {
        return { content: '至少需要提供一个要修改的章节字段。', isError: true }
      }

      const db = await ensureWorkspaceDb()
      const requestedTitle = hasOwn(input, 'title') ? String(input.title ?? '').trim() : chapter.title
      const summary = hasOwn(input, 'summary') ? String(input.summary ?? '').trim() : chapter.summary
      const status = hasOwn(input, 'status') ? String(input.status ?? '').trim() : chapter.status
      const wordTarget = hasOwn(input, 'word_target') ? String(input.word_target ?? '').trim() : chapter.word_target
      if (!requestedTitle) return { content: 'title 不能为空。', isError: true }
      if (!CHAPTER_STATUSES.has(status)) return { content: `无效章节状态：${status}`, isError: true }
      if (!wordTarget) return { content: 'word_target 不能为空。', isError: true }

      let volumeId = hasOwn(input, 'volume_id') ? String(input.volume_id ?? '').trim() : chapter.volume_id
      let outlineItemId = hasOwn(input, 'outline_item_id')
        ? String(input.outline_item_id ?? '').trim()
        : chapter.outline_item_id

      const outline = outlineItemId
        ? db.prepare('SELECT id, volume_id, title FROM outline_items WHERE id = ? AND project_id = ?')
          .get(outlineItemId, deps.projectId) as { id: string; volume_id: string; title: string } | undefined
        : undefined
      if (outlineItemId && !outline) {
        return { content: `大纲节点不存在：${outlineItemId}`, isError: true }
      }
      if (outline) {
        if (hasOwn(input, 'volume_id') && volumeId && volumeId !== outline.volume_id) {
          return { content: 'volume_id 与 outline_item_id 所属分卷不一致；跨分卷移动时请同时传 outline_item_id="" 解除原大纲绑定。', isError: true }
        }
        volumeId = outline.volume_id
        outlineItemId = outline.id
      }

      const volume = db.prepare('SELECT id, title FROM outline_volumes WHERE id = ? AND project_id = ?')
        .get(volumeId, deps.projectId) as { id: string; title: string } | undefined
      if (!volume) return { content: `分卷不存在：${volumeId}`, isError: true }
      const oldVolume = db.prepare('SELECT title FROM outline_volumes WHERE id = ? AND project_id = ?')
        .get(chapter.volume_id, deps.projectId) as { title: string } | undefined
      const oldOutline = chapter.outline_item_id
        ? db.prepare('SELECT title FROM outline_items WHERE id = ? AND project_id = ?')
          .get(chapter.outline_item_id, deps.projectId) as { title: string } | undefined
        : undefined

      const before = renderChapterMetadata({
        title: chapter.title,
        summary: chapter.summary,
        status: chapter.status,
        wordTarget: chapter.word_target,
        volumeTitle: oldVolume?.title ?? '',
        outlineTitle: oldOutline?.title ?? ''
      })
      const after = renderChapterMetadata({
        title: requestedTitle,
        summary,
        status,
        wordTarget,
        volumeTitle: volume.title,
        outlineTitle: outline?.title ?? ''
      })
      if (before === after) return { content: '章节元数据没有发生变化。', isError: true }

      const reason = String(input.reason ?? '').trim() || '（未提供理由）'
      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'chapter',
        action: 'update',
        entityId: chapter.id,
        entityTitle: requestedTitle,
        reason,
        before,
        after,
        entityPayload: {
          chapterUpdateType: 'metadata',
          title: requestedTitle,
          summary,
          status,
          wordTarget,
          volumeId,
          outlineItemId
        }
      })
      return { content: `已暂存章节元数据修改（change_id=${change.id}）：${requestedTitle}。尚未写回，需用户确认。` }
    }
  }
}

export function makeListChapterVersionsTool(deps: StageChapterManagementToolDeps): Tool {
  return {
    definition: {
      name: 'list_chapter_versions',
      description: '列出指定章节的历史版本，返回可供 stage_chapter_restore 使用的 version_id。chapter_id 省略时使用当前章节。',
      inputSchema: {
        type: 'object',
        properties: {
          chapter_id: { type: 'string', description: '章节 ID、标题或自然引用；省略时使用当前章节。' },
          limit: { type: 'integer', description: '最多返回多少个版本，默认 10，最大 20。' },
          include_content: { type: 'boolean', description: '是否附带每个版本的正文预览，默认 false。' }
        }
      }
    },
    handler: async (input) => {
      let chapterId = ''
      try {
        chapterId = await resolveChapterRef(deps, input)
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true }
      }
      const chapter = await readChapter(deps.projectId, chapterId)
      if (!chapter) return { content: `章节不存在：${chapterId}`, isError: true }

      const limit = Math.min(20, Math.max(1, Number(input.limit) || 10))
      const db = await ensureWorkspaceDb()
      const versions = db.prepare(`
        SELECT id, chapter_id, title, summary, status, word_target, content, created_at
        FROM chapter_versions
        WHERE chapter_id = ? AND project_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      `).all(chapterId, deps.projectId, limit) as ChapterVersionRow[]
      if (!versions.length) return { content: `章节【${chapter.title}】还没有历史版本。` }

      const includeContent = input.include_content === true
      const lines = versions.map((version, index) => {
        const plain = stripHtml(version.content)
        const detail = [
          `${index + 1}. version_id=${version.id}`,
          `时间：${version.created_at}`,
          `标题：${version.title}`,
          `状态：${version.status}`,
          `摘要：${version.summary || '（空）'}`,
          `正文字符数：${plain.replace(/\s/g, '').length}`,
          includeContent ? `正文预览：${plain.slice(0, 500)}${plain.length > 500 ? '…' : ''}` : ''
        ].filter(Boolean)
        return detail.join('\n')
      })
      return { content: `章节【${chapter.title}】历史版本共返回 ${versions.length} 个：\n\n${lines.join('\n\n')}` }
    }
  }
}

export function makeStageChapterRestoreTool(deps: StageChapterManagementToolDeps): Tool {
  return {
    definition: {
      name: 'stage_chapter_restore',
      description:
        '暂存将章节恢复到指定历史版本。必须使用 list_chapter_versions 返回的 version_id。恢复会覆盖标题、摘要、状态、字数目标和正文；用户确认写回时会先保存当前章节快照。',
      inputSchema: {
        type: 'object',
        properties: {
          version_id: { type: 'string', description: '要恢复的历史版本 ID。' },
          reason: { type: 'string', description: '简短说明恢复原因。' }
        },
        required: ['version_id', 'reason']
      }
    },
    handler: async (input) => {
      const versionId = String(input.version_id ?? '').trim()
      if (!versionId) return { content: 'version_id 不能为空。', isError: true }

      const db = await ensureWorkspaceDb()
      const version = db.prepare(`
        SELECT id, chapter_id, title, summary, status, word_target, content, created_at
        FROM chapter_versions
        WHERE id = ? AND project_id = ?
      `).get(versionId, deps.projectId) as ChapterVersionRow | undefined
      if (!version) return { content: `历史版本不存在：${versionId}`, isError: true }
      const chapter = await readChapter(deps.projectId, version.chapter_id)
      if (!chapter) return { content: `历史版本对应的章节不存在：${version.chapter_id}`, isError: true }

      const beforePlain = stripHtml(chapter.content)
      const afterPlain = stripHtml(version.content)
      const before = [
        `标题：${chapter.title}`,
        `摘要：${chapter.summary || '（空）'}`,
        `状态：${chapter.status}`,
        `字数目标：${chapter.word_target}`,
        `正文：\n${beforePlain || '（空）'}`
      ].join('\n')
      const after = [
        `恢复版本：${version.id}（${version.created_at}）`,
        `标题：${version.title}`,
        `摘要：${version.summary || '（空）'}`,
        `状态：${version.status}`,
        `字数目标：${version.word_target}`,
        `正文：\n${afterPlain || '（空）'}`
      ].join('\n')
      if (
        chapter.title === version.title &&
        chapter.summary === version.summary &&
        chapter.status === version.status &&
        chapter.word_target === version.word_target &&
        chapter.content === version.content
      ) {
        return { content: '当前章节已经与该历史版本一致。', isError: true }
      }

      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'chapter',
        action: 'update',
        entityId: chapter.id,
        entityTitle: chapter.title,
        reason: String(input.reason ?? '').trim() || '（未提供理由）',
        before,
        after,
        chapterHtml: { old: chapter.content, new: version.content },
        entityPayload: {
          chapterUpdateType: 'restore',
          restoreVersionId: version.id
        }
      })
      return { content: `已暂存章节版本恢复（change_id=${change.id}）：${chapter.title} → ${version.created_at}。尚未写回，需用户确认。` }
    }
  }
}

export function makeChapterManagementTools(deps: StageChapterManagementToolDeps): Tool[] {
  return [
    makeStageChapterUpdateTool(deps),
    makeListChapterVersionsTool(deps),
    makeStageChapterRestoreTool(deps)
  ]
}
