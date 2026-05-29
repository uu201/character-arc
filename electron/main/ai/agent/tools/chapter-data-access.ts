import { randomUUID } from 'node:crypto'
import { ensureWorkspaceDb } from '../../../workspace-store'

/** 章节完整数据 */
export type ChapterData = {
  id: string
  projectId: string
  volumeId: string
  title: string
  summary: string
  status: string
  wordTarget: string
  content: string
  sortOrder: number
}

/** 章节摘要条目（列表展示用） */
export type ChapterSummaryItem = {
  id: string
  title: string
  summary: string
  status: string
  wordCount: number
}

/** 章节编辑操作描述 */
export type ChapterEdit = {
  operation: 'replace' | 'insert' | 'append'
  search?: string
  content: string
  position?: 'before' | 'after' | 'start' | 'end'
}

/** 全局搜索结果条目 */
export type SearchResult = {
  type: string
  title: string
  content: string
}

/**
 * 去除 HTML 标签并解码常见 HTML 实体
 * @param html - HTML 字符串
 * @returns 纯文本
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 统计 HTML 正文的纯文本字数（不含空白）
 * @param html - HTML 字符串
 * @returns 字数
 */
function countChars(html: string): number {
  return stripHtmlTags(html).replace(/\s/g, '').length
}

/**
 * 从数据库读取单个章节的完整数据
 * @param projectId - 项目 ID
 * @param chapterId - 章节 ID
 * @returns 章节数据，不存在时返回 null
 */
export async function readChapterFromDb(projectId: string, chapterId: string): Promise<ChapterData | null> {
  const db = await ensureWorkspaceDb()
  const row = db.prepare(
    'SELECT id, project_id, volume_id, title, summary, status, word_target, content, sort_order FROM chapters WHERE id = ? AND project_id = ?'
  ).get(chapterId, projectId) as Record<string, unknown> | undefined

  if (!row) return null
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    volumeId: String(row.volume_id),
    title: String(row.title),
    summary: String(row.summary),
    status: String(row.status),
    wordTarget: String(row.word_target),
    content: String(row.content),
    sortOrder: Number(row.sort_order)
  }
}

/**
 * 列出项目下所有章节的摘要信息
 * @param projectId - 项目 ID
 * @returns 章节摘要数组，按 sortOrder 排序
 */
export async function listProjectChapters(projectId: string): Promise<ChapterSummaryItem[]> {
  const db = await ensureWorkspaceDb()
  const rows = db.prepare(
    'SELECT id, title, summary, status, content FROM chapters WHERE project_id = ? ORDER BY sort_order'
  ).all(projectId) as Record<string, unknown>[]

  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    status: String(row.status),
    wordCount: countChars(String(row.content))
  }))
}

/**
 * 对章节正文执行编辑操作（replace/insert/append），并自动保存版本快照
 * @param projectId - 项目 ID
 * @param chapterId - 章节 ID
 * @param edit - 编辑操作描述
 * @returns 版本 ID 和操作预览文本
 */
export async function applyChapterEdit(
  projectId: string,
  chapterId: string,
  edit: ChapterEdit
): Promise<{ versionId: string; preview: string }> {
  const db = await ensureWorkspaceDb()

  const row = db.prepare(
    'SELECT id, title, summary, status, word_target, content FROM chapters WHERE id = ? AND project_id = ?'
  ).get(chapterId, projectId) as Record<string, unknown> | undefined

  if (!row) throw new Error(`章节不存在: ${chapterId}`)

  const oldContent = String(row.content)
  const plainOld = stripHtmlTags(oldContent)

  const versionId = randomUUID()
  db.prepare(`
    INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, projectId, chapterId,
    String(row.title), String(row.summary), String(row.status), String(row.word_target),
    oldContent, new Date().toISOString()
  )

  let newContent: string
  let preview: string

  if (edit.operation === 'append') {
    const htmlToAppend = textToHtmlParagraphs(edit.content)
    newContent = oldContent + htmlToAppend
    preview = `追加了 ${edit.content.length} 字`
  } else if (edit.operation === 'replace') {
    if (!edit.search) throw new Error('replace 操作需要 search 参数')
    const searchText = edit.search.trim()
    if (!plainOld.includes(searchText)) {
      throw new Error(`未找到要替换的文本片段: "${searchText.slice(0, 50)}..."`)
    }
    newContent = replaceInHtml(oldContent, searchText, edit.content)
    preview = `替换了 "${searchText.slice(0, 30)}..." → "${edit.content.slice(0, 30)}..."`
  } else if (edit.operation === 'insert') {
    if (!edit.search && edit.position !== 'start' && edit.position !== 'end') {
      throw new Error('insert 操作需要 search 或 position 参数')
    }
    const htmlToInsert = textToHtmlParagraphs(edit.content)
    if (edit.position === 'start') {
      newContent = htmlToInsert + oldContent
    } else if (edit.position === 'end' || !edit.search) {
      newContent = oldContent + htmlToInsert
    } else {
      newContent = insertInHtml(oldContent, edit.search, htmlToInsert, edit.position ?? 'after')
    }
    preview = `插入了 ${edit.content.length} 字`
  } else {
    throw new Error(`不支持的操作: ${edit.operation}`)
  }

  db.prepare('UPDATE chapters SET content = ? WHERE id = ? AND project_id = ?')
    .run(newContent, chapterId, projectId)

  return { versionId, preview }
}

/**
 * 在项目数据中全文搜索（世界观、角色、大纲、章节、知识文档、剧情线索）
 * @param projectId - 项目 ID
 * @param query - 搜索关键词
 * @param scope - 可选的搜索范围过滤
 * @param maxResults - 最大返回条数，默认 10
 * @returns 匹配的搜索结果数组
 */
export async function searchProjectData(
  projectId: string,
  query: string,
  scope?: string[],
  maxResults = 10
): Promise<SearchResult[]> {
  const db = await ensureWorkspaceDb()
  const results: SearchResult[] = []
  const q = query.toLowerCase()
  const shouldSearch = (s: string) => !scope || scope.includes(s)

  if (shouldSearch('worldview') && results.length < maxResults) {
    const rows = db.prepare(
      'SELECT title, content FROM worldview_entries WHERE project_id = ?'
    ).all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const title = String(row.title)
      const content = String(row.content)
      if (title.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
        results.push({ type: '世界观', title, content: content.slice(0, 500) })
      }
    }
  }

  if (shouldSearch('characters') && results.length < maxResults) {
    const rows = db.prepare(
      'SELECT name, role, description FROM characters WHERE project_id = ?'
    ).all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const name = String(row.name)
      const role = String(row.role)
      const desc = String(row.description)
      if (name.toLowerCase().includes(q) || role.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
        results.push({ type: '角色', title: `${name}（${role}）`, content: desc.slice(0, 500) })
      }
    }
  }

  if (shouldSearch('outline') && results.length < maxResults) {
    const rows = db.prepare(
      'SELECT title, summary, conflict FROM outline_items WHERE project_id = ?'
    ).all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const title = String(row.title)
      const summary = String(row.summary)
      const conflict = String(row.conflict ?? '')
      if (title.toLowerCase().includes(q) || summary.toLowerCase().includes(q) || conflict.toLowerCase().includes(q)) {
        results.push({ type: '大纲', title, content: [summary, conflict].filter(Boolean).join(' | ').slice(0, 500) })
      }
    }
  }

  if (shouldSearch('chapters') && results.length < maxResults) {
    const rows = db.prepare(
      'SELECT title, summary FROM chapters WHERE project_id = ?'
    ).all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const title = String(row.title)
      const summary = String(row.summary)
      if (title.toLowerCase().includes(q) || summary.toLowerCase().includes(q)) {
        results.push({ type: '章节', title, content: summary.slice(0, 300) })
      }
    }
  }

  if (shouldSearch('knowledge') && results.length < maxResults) {
    const rows = db.prepare(
      'SELECT title, content FROM knowledge_documents WHERE project_id = ?'
    ).all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const title = String(row.title)
      const content = String(row.content)
      if (title.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
        results.push({ type: '知识文档', title, content: content.slice(0, 500) })
      }
    }
  }

  if (shouldSearch('plot_threads') && results.length < maxResults) {
    const rows = db.prepare(
      'SELECT title, description FROM plot_threads WHERE project_id = ?'
    ).all(projectId) as Record<string, unknown>[]
    for (const row of rows) {
      if (results.length >= maxResults) break
      const title = String(row.title)
      const desc = String(row.description)
      if (title.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
        results.push({ type: '剧情线索', title, content: desc.slice(0, 500) })
      }
    }
  }

  return results
}

/**
 * 将纯文本按换行分割并包装为 HTML 段落
 * @param text - 纯文本
 * @returns HTML 字符串
 */
function textToHtmlParagraphs(text: string): string {
  return text.split(/\n{2,}|\n/).filter(Boolean).map((p) => `<p>${p.trim()}</p>`).join('')
}

/**
 * 将纯文本中的字符索引映射到包含 HTML 标签的原始字符串中的位置
 * @param html - 包含标签的 HTML 字符串
 * @param plainIdx - 纯文本中的字符索引
 * @returns HTML 字符串中对应的字节位置
 */
function mapPlainIndexToHtml(html: string, plainIdx: number): number {
  let charCount = 0
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      while (i < html.length && html[i] !== '>') i++
      i++
      continue
    }
    if (html[i] === '&') {
      const semiIdx = html.indexOf(';', i)
      if (semiIdx !== -1 && semiIdx - i < 10) {
        if (charCount === plainIdx) return i
        charCount++
        i = semiIdx + 1
        continue
      }
    }
    if (charCount === plainIdx) return i
    charCount++
    i++
  }
  return i
}

/**
 * 在 HTML 字符串中查找纯文本文本段并替换为新内容
 * @param html - 原始 HTML 字符串
 * @param searchPlain - 要查找的纯文本片段
 * @param replacePlain - 替换用的纯文本
 * @returns 替换后的 HTML 字符串
 */
function replaceInHtml(html: string, searchPlain: string, replacePlain: string): string {
  const plain = stripHtmlTags(html)
  const idx = plain.indexOf(searchPlain)
  if (idx === -1) return html

  const startPos = mapPlainIndexToHtml(html, idx)
  const endPos = mapPlainIndexToHtml(html, idx + searchPlain.length)
  const hasNewlines = /\n/.test(replacePlain.trim())
  const replaceHtml = hasNewlines ? textToHtmlParagraphs(replacePlain) : escapeHtml(replacePlain)
  return html.slice(0, startPos) + replaceHtml + html.slice(endPos)
}

/**
 * 在 HTML 字符串中搜索纯文本文本段，然后在其前/后插入新内容
 * @param html - 原始 HTML 字符串
 * @param searchPlain - 定位用的纯文本片段
 * @param insertHtml - 要插入的 HTML 字符串
 * @param position - 插入位置：before 或 after
 * @returns 插入后的 HTML 字符串
 */
function insertInHtml(html: string, searchPlain: string, insertHtml: string, position: 'before' | 'after'): string {
  const plain = stripHtmlTags(html)
  const idx = plain.indexOf(searchPlain)
  if (idx === -1) return html + insertHtml

  const targetCharIdx = position === 'before' ? idx : idx + searchPlain.length
  const pos = mapPlainIndexToHtml(html, targetCharIdx)
  return html.slice(0, pos) + insertHtml + html.slice(pos)
}
